/**
 * SettingsPage：设置页 —— 单价配置、备份导出/恢复、数据与权限说明。
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import SaveIcon from '@mui/icons-material/Save';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { repository } from '../db/repository';
import { useTenantStore } from '../store/tenantStore';
import { useRoomStore } from '../store/roomStore';
import { useFeeStore } from '../store/feeStore';
import { useBillStore } from '../store/billStore';
import {
  subscribeOta,
  checkForUpdate,
  type OtaState,
} from '../services/otaUpdater';
import { useSystemStatus, permLabel, type PermState } from '../hooks/useSystemStatus';
import {
  downloadBackup,
  importAll,
  importLight,
  type BackupKind,
} from '../services/backup';
import { parseYuanInput, yuanToCents } from '../utils/money';
import { readFileAsText } from '../utils/format';

/** 构建版本（vite define 注入） */
declare const __APP_VERSION__: string;

type ChipSpec = { text: string; color: 'default' | 'success' | 'error' };

/** 权限状态 → 目标样式 */
function permChip(state: PermState, text: string): ChipSpec {
  return {
    text,
    color: state === 'granted' ? 'success' : state === 'denied' ? 'error' : 'default',
  };
}

/** 一行状态展示：左侧名称，右侧状态标签 */
function StatusRow({ label, chip }: { label: string; chip: ChipSpec }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ py: 1 }}>
      <Typography variant="body2" sx={{ flexGrow: 1 }}>
        {label}
      </Typography>
      <Chip
        size="small"
        label={chip.text}
        color={chip.color}
        variant={chip.color === 'default' ? 'outlined' : 'filled'}
      />
    </Stack>
  );
}

export function SettingsPage() {
  const [landlordName, setLandlordName] = useState(repository.getSettings().landlordName);
  const [priceYuan, setPriceYuan] = useState(
    (repository.getSettings().electricityUnitPrice / 100).toFixed(2),
  );
  const [msg, setMsg] = useState<{ text: string; sev: 'success' | 'error' | 'info' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ota, setOta] = useState<OtaState>({ phase: 'idle', current: __APP_VERSION__ });
  const { camera, location, time } = useSystemStatus();

  useEffect(() => subscribeOta(setOta), []);

  const fullInput = useRef<HTMLInputElement | null>(null);
  const lightInput = useRef<HTMLInputElement | null>(null);

  function reloadStores() {
    useTenantStore.getState().load();
    useRoomStore.getState().load();
    useFeeStore.getState().load();
    useBillStore.getState().load();
  }

  function handleSaveSettings() {
    repository.saveSettings({
      ...repository.getSettings(),
      landlordName: landlordName.trim() || '房东',
      electricityUnitPrice: yuanToCents(parseYuanInput(priceYuan)),
    });
    setMsg({ text: '设置已保存', sev: 'success' });
  }

  async function handleExport(kind: BackupKind) {
    setBusy(true);
    try {
      const name = await downloadBackup(kind);
      setMsg({ text: `已导出：${name}`, sev: 'success' });
    } catch (err) {
      console.error(err);
      setMsg({ text: '导出失败', sev: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(kind: BackupKind, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const text = await readFileAsText(file);
      if (kind === 'full') {
        const n = await importAll(text);
        setMsg({ text: `恢复成功（含 ${n} 张照片），即将刷新`, sev: 'success' });
      } else {
        importLight(text);
        setMsg({ text: '轻量恢复成功，即将刷新', sev: 'success' });
      }
      reloadStores();
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      setMsg({ text: `恢复失败：${err?.message ?? '文件格式不正确'}`, sev: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        设置
      </Typography>

      {msg && (
        <Alert severity={msg.sev} sx={{ mb: 2 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            费用单价与署名
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="房东署名（用于催缴文案）"
              value={landlordName}
              onChange={(e) => setLandlordName(e.target.value)}
              fullWidth
            />
            <TextField
              label="电费单价（元/度）"
              type="number"
              value={priceYuan}
              onChange={(e) => setPriceYuan(e.target.value)}
              fullWidth
              inputProps={{ step: '0.01', min: 0 }}
            />
            <Button startIcon={<SaveIcon />} onClick={handleSaveSettings} variant="contained" disableElevation>
              保存设置
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            备份与恢复
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            数据仅存本机，建议定期导出。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              startIcon={<DownloadIcon />}
              onClick={() => handleExport('full')}
              disabled={busy}
            >
              导出全量（含照片）
            </Button>
            <Button
              startIcon={<DownloadIcon />}
              onClick={() => handleExport('light')}
              disabled={busy}
              variant="outlined"
            >
              导出轻量（无照片）
            </Button>
            <Button
              startIcon={<UploadIcon />}
              onClick={() => fullInput.current?.click()}
              disabled={busy}
            >
              恢复全量
            </Button>
            <input
              ref={fullInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => handleImport('full', e)}
            />
            <Button
              startIcon={<UploadIcon />}
              onClick={() => lightInput.current?.click()}
              disabled={busy}
              variant="outlined"
            >
              恢复轻量
            </Button>
            <input
              ref={lightInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => handleImport('light', e)}
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            权限与时间
          </Typography>
          <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
            <StatusRow label="相机" chip={permChip(camera, permLabel(camera))} />
            <StatusRow label="定位" chip={permChip(location, permLabel(location))} />
            <StatusRow
              label="时间校验"
              chip={
                time === 'checking'
                  ? { text: '校验中…', color: 'default' as const }
                  : time === 'ok'
                    ? { text: '已校准', color: 'success' as const }
                    : time === 'off'
                      ? { text: '本机时间不准', color: 'error' as const }
                      : { text: '未校验（离线）', color: 'default' as const }
              }
            />
          </Stack>
          {time === 'off' && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              请开启手机「自动对时」，否则照片水印时间会不准。
            </Alert>
          )}
          {(camera === 'denied' || location === 'denied') && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              权限被拒绝，请在系统设置中允许后重试。
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            软件更新
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            当前版本：{ota.current}（内置版本 {__APP_VERSION__}）
          </Typography>
          {ota.message && (
            <Alert
              severity={
                ota.phase === 'error'
                  ? 'error'
                  : ota.phase === 'uptodate' || ota.phase === 'updated'
                    ? 'success'
                    : 'info'
              }
              sx={{ mb: 1 }}
            >
              {ota.message}
            </Alert>
          )}
          <Button
            startIcon={<SystemUpdateAltIcon />}
            onClick={() => checkForUpdate({ apply: true })}
            disabled={ota.phase === 'checking' || ota.phase === 'downloading' || ota.phase === 'applying'}
            variant="contained"
            disableElevation
          >
            {ota.phase === 'checking' || ota.phase === 'downloading' || ota.phase === 'applying'
              ? '处理中…'
              : '检查更新'}
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            仅更新网页层，不影响本机数据；原生改动仍需重编 APK。
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            关于
          </Typography>
          <Typography variant="body2" color="text.secondary">
            房东管理系统 · 版本 {__APP_VERSION__}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            数据仅存本机；身份证展示已脱敏。
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

export default SettingsPage;