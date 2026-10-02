/**
 * TenantDetail：租户详情对话框。
 * 展示脱敏身份证、可选证件照（含哈希校验）、押金、缴费记录、近几个月账单；
 * 支持「登记缴费」与「生成账单」。
 */
import { useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import type { Tenant, Room, Bill } from '../../types';
import MaskedField from '../common/MaskedField';
import PhotoUpload from '../common/PhotoUpload';
import PaymentForm from './PaymentForm';
import { useBillStore } from '../../store/billStore';
import { formatCents, formatOutstanding } from '../../utils/money';
import { cycleLabel } from '../../services/billingEngine';
import { currentMonth, formatMonthCN } from '../../utils/date';
import { billStatusLabel } from '../../utils/labels';

interface TenantDetailProps {
  open: boolean;
  onClose: () => void;
  tenant: Tenant;
  room?: Room;
  /** 删除该租户（由父级弹确认框） */
  onDelete?: () => void;
}

export function TenantDetail({ open, onClose, tenant, room, onDelete }: TenantDetailProps) {
  const [payOpen, setPayOpen] = useState(false);
  const regenerateTenantBill = useBillStore((s) => s.regenerateTenantBill);
  const bills = useBillStore((s) => s.bills);
  const payments = useBillStore((s) => s.payments);

  const tenantBills = useMemo(
    () =>
      bills
        .filter((b) => b.tenantId === tenant.id)
        .sort((a, b) => (a.month < b.month ? 1 : -1)),
    [bills, tenant.id],
  );
  const tenantPayments = useMemo(
    () =>
      payments
        .filter((p) => p.tenantId === tenant.id)
        .sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1)),
    [payments, tenant.id],
  );

  function handleRegenerate() {
    // 重新生成本月账单
    regenerateTenantBill(tenant.id, currentMonth());
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
        <DialogTitle>{tenant.name} 的档案</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="overline" color="text.secondary">
                基本信息
              </Typography>
              <MaskedField value={tenant.idCard} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                电话：{tenant.phone || '未填'}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={cycleLabel(tenant.paymentCycle)} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    typeof tenant.depositAmount === 'number' && tenant.depositAmount > 0
                      ? `押金 ${formatCents(tenant.depositAmount)}（${tenant.depositMonths} 个月）`
                      : `押金 ${tenant.depositMonths} 个月`
                  }
                />
                <Chip
                  size="small"
                  label={tenant.depositType === 'refundable' ? '押金可退' : '押金抵扣'}
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={tenant.depositDeductibleOnExit ? '退租可扣款' : '退租不可扣款'}
                  variant="outlined"
                />
                {room && <Chip size="small" label={`房间：${room.name}`} />}
              </Stack>
            </Box>

            {tenant.idCardPhotoId && (
              <Box>
                <Typography variant="overline" color="text.secondary">
                  证件照（水印防伪）
                </Typography>
                <PhotoUpload
                  label="证件照"
                  value={{
                    photoId: tenant.idCardPhotoId,
                    photoHash: tenant.idCardPhotoHash ?? '',
                    capturedAt: tenant.idCardCapturedAt ?? tenant.createdAt,
                    lat: tenant.idCardLat ?? null,
                    lng: tenant.idCardLng ?? null,
                  }}
                  onChange={() => {}}
                />
              </Box>
            )}

            <Box>
              <Typography variant="overline" color="text.secondary">
                账单（近月）
              </Typography>
              {tenantBills.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  暂无账单
                </Typography>
              )}
              <List dense>
                {tenantBills.slice(0, 6).map((b: Bill) => (
                  <ListItem key={b.id} disableGutters>
                    <ListItemText
                      primary={`${formatMonthCN(b.month)} · 应收 ${formatCents(b.totalReceivable)} · ${formatOutstanding(b.outstanding)}`}
                      secondary={`状态：${billStatusLabel(b.status)}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>

            <Divider />

            <Box>
              <Typography variant="overline" color="text.secondary">
                缴费记录
              </Typography>
              {tenantPayments.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  暂无缴费记录
                </Typography>
              )}
              <List dense>
                {tenantPayments.slice(0, 8).map((p) => (
                  <ListItem key={p.id} disableGutters>
                    <ListItemText
                      primary={`${formatCents(p.amount)}（${
                        p.category === 'deposit' ? '押金' : p.category === 'other' ? '其他' : p.prepaid ? '预收租金' : '租金'
                      }）`}
                      secondary={`归属 ${p.billMonth}${p.prepaid && p.periodStart ? ` · 预收覆盖 ${p.periodStart}~${p.periodEnd}` : ''} · ${p.method ?? ''}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {onDelete ? (
            <Button color="error" onClick={onDelete}>
              删除租户
            </Button>
          ) : (
            <span />
          )}
          <Stack direction="row" spacing={1}>
            <Button onClick={handleRegenerate}>刷新本月账单</Button>
            <Button onClick={() => setPayOpen(true)} variant="contained" disableElevation>
              登记缴费
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <PaymentForm
        open={payOpen}
        onClose={() => setPayOpen(false)}
        tenant={tenant}
        defaultMonth={currentMonth()}
      />
    </>
  );
}

export default TenantDetail;