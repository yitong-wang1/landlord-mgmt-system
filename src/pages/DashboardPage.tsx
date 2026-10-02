/**
 * DashboardPage：首页看板（本月欠费概览 + 快捷入口）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useBillStore } from '../store/billStore';
import { useTenantStore } from '../store/tenantStore';
import { useRoomStore } from '../store/roomStore';
import { formatCents, formatOutstanding } from '../utils/money';
import { currentMonth, formatMonthCN } from '../utils/date';

export function DashboardPage() {
  const navigate = useNavigate();
  const regenerateMonth = useBillStore((s) => s.regenerateMonth);
  const bills = useBillStore((s) => s.bills);
  const tenants = useTenantStore((s) => s.tenants);
  const rooms = useRoomStore((s) => s.rooms);

  const month = currentMonth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    regenerateMonth(month);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const monthBills = useMemo(() => bills.filter((b) => b.month === month), [bills, month]);
  const totalOutstanding = monthBills.reduce((s, b) => s + Math.max(0, b.outstanding), 0);
  const owed = monthBills.filter((b) => b.outstanding > 0);
  const rentedCount = rooms.filter((r) => r.status === 'rented').length;

  function tenantName(id: string) {
    return tenants.find((t) => t.id === id)?.name ?? '租户';
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {formatMonthCN(month)} 概览
      </Typography>

      {!ready && <Alert severity="info" sx={{ mb: 2 }}>正在生成账单…</Alert>}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">本月欠费合计</Typography>
              <Typography variant="h5" color={totalOutstanding > 0 ? 'error' : 'success'}>
                {formatCents(totalOutstanding)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">欠费人数</Typography>
              <Typography variant="h5">{owed.length}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">在租房间</Typography>
              <Typography variant="h5">{rentedCount}/{rooms.length}</Typography>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => regenerateMonth(month)}>
              刷新账单
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        欠费租户
      </Typography>
      {owed.length === 0 ? (
        <Alert severity="success">本月暂无欠费，太棒了 🎉</Alert>
      ) : (
        <Stack spacing={1}>
          {owed.map((b) => (
            <Card key={b.id} variant="outlined" onClick={() => navigate('/bills')} sx={{ cursor: 'pointer' }}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle2">{tenantName(b.tenantId)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      应收 {formatCents(b.totalReceivable)} · 已缴 {formatCents(b.totalPaid)}
                    </Typography>
                  </Box>
                  <Chip size="small" color="error" label={formatOutstanding(b.outstanding)} />
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 3 }} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" onClick={() => navigate('/tenants')}>租户管理</Button>
        <Button variant="outlined" onClick={() => navigate('/rooms')}>房间管理</Button>
        <Button variant="outlined" onClick={() => navigate('/fees')}>抄表/费用</Button>
        <Button variant="outlined" onClick={() => navigate('/bills')}>账单与催缴</Button>
      </Stack>
    </Box>
  );
}

export default DashboardPage;