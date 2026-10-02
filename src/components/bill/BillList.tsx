/**
 * BillList：月度账单列表（自动算账 + 欠费统计 + 生成/刷新）。
 */
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import RefreshIcon from '@mui/icons-material/Refresh';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import type { Bill } from '../../types';
import { useBillStore } from '../../store/billStore';
import { useTenantStore } from '../../store/tenantStore';
import { useRoomStore } from '../../store/roomStore';
import { formatCents, formatOutstanding } from '../../utils/money';
import { billStatusLabel } from '../../utils/labels';
import { currentMonth, formatMonthCN, prevMonth, nextMonth } from '../../utils/date';
import BillDetail from './BillDetail';
import ReminderExport from './ReminderExport';

export function BillList() {
  const regenerateMonth = useBillStore((s) => s.regenerateMonth);
  const bills = useBillStore((s) => s.bills);
  const tenants = useTenantStore((s) => s.tenants);
  const rooms = useRoomStore((s) => s.rooms);

  const [month, setMonth] = useState(currentMonth());
  const [detail, setDetail] = useState<Bill | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const monthBills = useMemo(
    () => bills.filter((b) => b.month === month),
    [bills, month],
  );

  const totalOutstanding = monthBills.reduce((s, b) => s + Math.max(0, b.outstanding), 0);
  const owedCount = monthBills.filter((b) => b.status === 'owed' || b.status === 'partial').length;

  function tenantName(id: string) {
    return tenants.find((t) => t.id === id)?.name ?? '未知租户';
  }
  function roomName(id: string) {
    return rooms.find((r) => r.id === id)?.name ?? '—';
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Button size="small" onClick={() => setMonth((m) => prevMonth(m))}>
          上月
        </Button>
        <TextField
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
        />
        <Button size="small" onClick={() => setMonth((m) => nextMonth(m))}>
          下月
        </Button>
        <Button size="small" startIcon={<RefreshIcon />} onClick={() => regenerateMonth(month)}>
          生成/刷新
        </Button>
        <Button
          size="small"
          startIcon={<NotificationsActiveIcon />}
          onClick={() => setReminderOpen(true)}
          color={owedCount > 0 ? 'error' : 'primary'}
        >
          催缴
        </Button>
      </Stack>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {formatMonthCN(month)} 欠费合计
              </Typography>
              <Typography variant="h6" color={totalOutstanding > 0 ? 'error' : 'success'}>
                {formatCents(totalOutstanding)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                欠费人数
              </Typography>
              <Typography variant="h6">{owedCount}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                账单数
              </Typography>
              <Typography variant="h6">{monthBills.length}</Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {monthBills.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
          该月暂无账单，点「生成/刷新」自动算账。
        </Typography>
      )}

      <Stack spacing={1.5}>
        {monthBills.map((b) => (
          <Card key={b.id} variant="outlined" onClick={() => setDetail(b)} sx={{ cursor: 'pointer' }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="subtitle1">
                    {tenantName(b.tenantId)} · {roomName(b.roomId)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    应收 {formatCents(b.totalReceivable)} · 已缴 {formatCents(b.totalPaid)}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="subtitle1" color={b.outstanding > 0 ? 'error' : 'success'}>
                    {formatOutstanding(b.outstanding)}
                  </Typography>
                  <Chip
                    size="small"
                    label={billStatusLabel(b.status)}
                    color={b.status === 'settled' ? 'success' : b.status === 'partial' ? 'warning' : 'error'}
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {detail && <BillDetail bill={detail} onClose={() => setDetail(null)} />}
      {reminderOpen && <ReminderExport month={month} onClose={() => setReminderOpen(false)} />}
    </Box>
  );
}

export default BillList;