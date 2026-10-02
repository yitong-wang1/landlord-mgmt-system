/**
 * BillDetail：账单详情（应收明细 / 已缴 / 欠费）。
 */
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Chip from '@mui/material/Chip';
import type { Bill } from '../../types';
import { useTenantStore } from '../../store/tenantStore';
import { useRoomStore } from '../../store/roomStore';
import { formatCents, formatOutstanding } from '../../utils/money';
import { billStatusLabel } from '../../utils/labels';
import { formatMonthCN } from '../../utils/date';

interface BillDetailProps {
  bill: Bill;
  onClose: () => void;
}

export function BillDetail({ bill, onClose }: BillDetailProps) {
  const tenants = useTenantStore((s) => s.tenants);
  const rooms = useRoomStore((s) => s.rooms);
  const tenant = tenants.find((t) => t.id === bill.tenantId);
  const room = rooms.find((r) => r.id === bill.roomId);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>
        {formatMonthCN(bill.month)} 账单 — {tenant?.name ?? '未知租户'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={billStatusLabel(bill.status)} />
            <Chip size="small" label={room?.name ?? '—'} variant="outlined" />
          </Stack>

          <Typography variant="subtitle2">应收明细</Typography>
          <List dense>
            {bill.items.map((it, idx) => (
              <ListItem key={`${it.feeTypeId}-${idx}`} disableGutters>
                <ListItemText
                  primary={`${it.feeName}：${formatCents(it.amount)}`}
                  secondary={[
                    it.note,
                    it.periodCovered ? `覆盖：${it.periodCovered}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </ListItem>
            ))}
          </List>

          <Divider />
          <Stack spacing={0.5}>
            <Typography>应收合计：{formatCents(bill.totalReceivable)}</Typography>
            <Typography>已缴合计：{formatCents(bill.totalPaid)}</Typography>
            <Typography variant="subtitle1" color={bill.outstanding > 0 ? 'error' : 'success'}>
              欠费：{formatOutstanding(bill.outstanding)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            生成时间：{new Date(bill.generatedAt).toLocaleString('zh-CN')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export default BillDetail;