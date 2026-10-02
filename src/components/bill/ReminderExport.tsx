/**
 * ReminderExport：催缴与账单导出。
 * - 列出该月欠费租户，一键生成催缴文案（可复制）。
 * - 导出账单明细为 CSV（Excel 可打开）。
 */
import { useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import ContentCopy from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import type { MonthStr } from '../../types';
import { useBillStore } from '../../store/billStore';
import { useTenantStore } from '../../store/tenantStore';
import { useRoomStore } from '../../store/roomStore';
import { repository } from '../../db/repository';
import { formatCents, formatOutstanding } from '../../utils/money';
import { formatMonthCN } from '../../utils/date';
import { downloadFile } from '../../utils/format';

interface ReminderExportProps {
  month: MonthStr;
  onClose: () => void;
}

export function ReminderExport({ month, onClose }: ReminderExportProps) {
  const bills = useBillStore((s) => s.bills);
  const tenantList = useTenantStore((s) => s.tenants);
  const rooms = useRoomStore((s) => s.rooms);
  const settings = repository.getSettings();
  const [copied, setCopied] = useState(false);

  const owedBills = useMemo(
    () => bills.filter((b) => b.month === month && b.outstanding > 0),
    [bills, month],
  );

  function tenantName(id: string) {
    return tenantList.find((t) => t.id === id)?.name ?? '租户';
  }

  const reminderText = useMemo(() => {
    const lines = [
      `【${formatMonthCN(month)} 房租水电催缴】`,
      `${settings.landlordName} 提示：`,
      '',
      ...owedBills.map(
        (b) =>
          `- ${tenantName(b.tenantId)}（${rooms.find((r) => r.id === b.roomId)?.name ?? ''}）：${formatOutstanding(b.outstanding)}，请尽快缴纳。`,
      ),
      '',
      '感谢配合！',
    ];
    return lines.join('\n');
  }, [owedBills, month, settings.landlordName, tenantList, rooms]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reminderText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function handleExportCSV() {
    const header = ['月份', '租户', '房间', '项目', '金额(元)', '备注'];
    const rows: string[][] = [];
    for (const b of bills.filter((x) => x.month === month)) {
      for (const it of b.items) {
        rows.push([
          b.month,
          tenantName(b.tenantId),
          rooms.find((r) => r.id === b.roomId)?.name ?? '',
          it.feeName,
          (it.amount / 100).toFixed(2),
          it.note ?? '',
        ]);
      }
      rows.push([
        b.month,
        tenantName(b.tenantId),
        rooms.find((r) => r.id === b.roomId)?.name ?? '',
        '合计',
        (b.totalReceivable / 100).toFixed(2),
        `欠费 ${(b.outstanding / 100).toFixed(2)}`,
      ]);
    }
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadFile(`账单-${month}.csv`, '\uFEFF' + csv); // BOM 便于 Excel 识别中文
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>催缴 · {formatMonthCN(month)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {owedBills.length === 0 && (
            <Alert severity="success">该月暂无欠费，全部已结清 🎉</Alert>
          )}

          {owedBills.length > 0 && (
            <List dense>
              {owedBills.map((b) => (
                <ListItem key={b.id} disableGutters>
                  <ListItemText
                    primary={`${tenantName(b.tenantId)} · ${rooms.find((r) => r.id === b.roomId)?.name ?? ''}`}
                    secondary={`${formatCents(b.totalReceivable)} 应收 · ${formatOutstanding(b.outstanding)}`}
                  />
                </ListItem>
              ))}
            </List>
          )}

          {owedBills.length > 0 && (
            <TextField
              label="催缴文案（可编辑后复制）"
              value={reminderText}
              multiline
              minRows={5}
              fullWidth
              onChange={(e) => {
                /* 允许展示，但复制原文案；如需编辑可在此维护 state */
              }}
              InputProps={{ readOnly: true }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<DownloadIcon />} onClick={handleExportCSV}>
          导出账单 CSV
        </Button>
        {owedBills.length > 0 && (
          <Button startIcon={<ContentCopy />} onClick={handleCopy} variant="contained" disableElevation>
            {copied ? '已复制' : '复制催缴文案'}
          </Button>
        )}
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export default ReminderExport;