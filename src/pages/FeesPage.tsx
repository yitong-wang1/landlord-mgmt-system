/**
 * FeesPage：费用页 —— 电表抄表录入 / 供暖费登记 / 自定义费用管理。
 */
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import VerifiedIcon from '@mui/icons-material/Verified';
import type { MeterRecord, HeatingFee } from '../types';
import { useFeeStore } from '../store/feeStore';
import { useRoomStore } from '../store/roomStore';
import { useTenantStore } from '../store/tenantStore';
import { repository } from '../db/repository';
import { usePhotoUrl, verifyPhotoIntegrity } from '../hooks/usePhoto';
import { formatCents } from '../utils/money';
import { formatMonthCN } from '../utils/date';
import { heatingStatusLabel } from '../utils/labels';
import MeterRecordForm from '../components/fee/MeterRecordForm';
import HeatingFeeForm from '../components/fee/HeatingFeeForm';
import FeeTypeManager from '../components/fee/FeeTypeManager';

/** 电表照片缩略图 + 哈希校验 */
function MeterPhotoThumb({ rec }: { rec: MeterRecord }) {
  const url = usePhotoUrl(rec.photoId);
  if (!rec.photoId) return null;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {url && (
        <Box component="img" src={url} alt="电表" sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1, bgcolor: '#eee' }} />
      )}
      <Button
        size="small"
        startIcon={<VerifiedIcon />}
        onClick={async () => {
          const res = await verifyPhotoIntegrity(rec.photoId, rec.photoHash);
          alert(res.ok ? '校验通过：图片未被替换' : res.reason);
        }}
      >
        校验
      </Button>
    </Stack>
  );
}

export function FeesPage() {
  const meterRecords = useFeeStore((s) => s.meterRecords);
  const heatingFees = useFeeStore((s) => s.heatingFees);
  const rooms = useRoomStore((s) => s.rooms);
  const tenants = useTenantStore((s) => s.tenants);
  const settings = repository.getSettings();
  const unitPrice = settings.electricityUnitPrice;

  const [tab, setTab] = useState(0);
  const [meterFormOpen, setMeterFormOpen] = useState(false);
  const [editingMeter, setEditingMeter] = useState<MeterRecord | undefined>();
  const [heatingFormOpen, setHeatingFormOpen] = useState(false);
  const [editingHeating, setEditingHeating] = useState<HeatingFee | undefined>();

  function roomName(id: string) {
    return rooms.find((r) => r.id === id)?.name ?? '—';
  }

  const sortedMeter = useMemo(
    () => [...meterRecords].sort((a, b) => (a.month === b.month ? (a.roomId < b.roomId ? 1 : -1) : a.month < b.month ? 1 : -1)),
    [meterRecords],
  );
  const sortedHeating = useMemo(
    () => [...heatingFees].sort((a, b) => b.year - a.year),
    [heatingFees],
  );

  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab label={`电费抄表 (${meterRecords.length})`} />
        <Tab label={`供暖费 (${heatingFees.length})`} />
        <Tab label="自定义费用" />
      </Tabs>

      {/* 电费抄表 */}
      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              电价：{(unitPrice / 100).toFixed(2)} 元/度（在设置页调整）
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disableElevation
              onClick={() => { setEditingMeter(undefined); setMeterFormOpen(true); }}
            >
              抄表录入
            </Button>
          </Box>
          {sortedMeter.length === 0 && (
            <Alert severity="info">暂无抄表记录，点「抄表录入」添加（含拍照录入）。</Alert>
          )}
          <Stack spacing={1.5}>
            {sortedMeter.map((m) => (
              <Card key={m.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="subtitle2">
                        {roomName(m.roomId)} · {formatMonthCN(m.month)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        用量 {m.usage} 度 · 预估电费 {formatCents(Math.round(m.usage * unitPrice))}
                      </Typography>
                    </Box>
                    <IconButton size="small" onClick={() => { setEditingMeter(m); setMeterFormOpen(true); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  {m.photoId && (
                    <Box sx={{ mt: 1 }}>
                      <MeterPhotoThumb rec={m} />
                    </Box>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {/* 供暖费 */}
      {tab === 1 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              供暖费按房间 + 供暖年登记，状态（已缴/未缴/部分）自动推导。
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disableElevation
              onClick={() => { setEditingHeating(undefined); setHeatingFormOpen(true); }}
            >
              登记供暖费
            </Button>
          </Box>
          {sortedHeating.length === 0 && (
            <Alert severity="info">暂无供暖费记录。</Alert>
          )}
          <Stack spacing={1.5}>
            {sortedHeating.map((h) => (
              <Card key={h.id} variant="outlined">
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="subtitle2">
                        {roomName(h.roomId)} · {h.year}-{h.year + 1} 供暖季
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        总额 {formatCents(h.amount)} · 已缴 {formatCents(h.paidAmount)}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={heatingStatusLabel(h.status)}
                      color={h.status === 'paid' ? 'success' : h.status === 'partial' ? 'warning' : 'default'}
                    />
                    <IconButton size="small" onClick={() => { setEditingHeating(h); setHeatingFormOpen(true); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {/* 自定义费用 */}
      {tab === 2 && (
        <FeeTypeManager rooms={rooms} tenants={tenants} />
      )}

      <MeterRecordForm
        open={meterFormOpen}
        onClose={() => setMeterFormOpen(false)}
        rooms={rooms}
        editRecord={editingMeter}
      />
      <HeatingFeeForm
        open={heatingFormOpen}
        onClose={() => setHeatingFormOpen(false)}
        rooms={rooms}
        editRecord={editingHeating}
      />
    </Box>
  );
}

export default FeesPage;