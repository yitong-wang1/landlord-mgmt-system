/**
 * PaymentForm：登记缴费记录（租金 / 押金 / 其他）。
 * - 季付/年付租金可勾选「预收整周期」，登记覆盖 [起, 止] 月份的一笔预收租金。
 * - 押金用 category='deposit' 记录；退租扣款/可退由押金类型与扣款开关控制。
 */
import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import type { PaymentCategory, Tenant } from '../../types';
import { useBillStore } from '../../store/billStore';
import { yuanToCents, parseYuanInput } from '../../utils/money';
import { currentMonth, monthAdd } from '../../utils/date';

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  tenant: Tenant;
  /** 默认归属月份 */
  defaultMonth?: string;
}

const CATEGORY_LABEL: { value: PaymentCategory; label: string }[] = [
  { value: 'rent', label: '租金' },
  { value: 'deposit', label: '押金' },
  { value: 'other', label: '其他（水电/供暖/自定义等）' },
];

export function PaymentForm({ open, onClose, tenant, defaultMonth }: PaymentFormProps) {
  const addPayment = useBillStore((s) => s.addPayment);

  const [amountYuan, setAmountYuan] = useState('');
  const [category, setCategory] = useState<PaymentCategory>('rent');
  const [month, setMonth] = useState(defaultMonth ?? currentMonth());
  const [prepaid, setPrepaid] = useState(false);
  const [periodStart, setPeriodStart] = useState(defaultMonth ?? currentMonth());
  const [periodEnd, setPeriodEnd] = useState('');
  const [method, setMethod] = useState('现金');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const isPrepaidCapable = tenant.paymentCycle === 'quarterly' || tenant.paymentCycle === 'yearly';

  useEffect(() => {
    if (!open) return;
    setAmountYuan('');
    setCategory('rent');
    setMonth(defaultMonth ?? currentMonth());
    setPrepaid(false);
    setPeriodStart(defaultMonth ?? currentMonth());
    setPeriodEnd(
      tenant.paymentCycle === 'yearly'
        ? monthAdd(defaultMonth ?? currentMonth(), 11)
        : monthAdd(defaultMonth ?? currentMonth(), 2),
    );
    setMethod('现金');
    setNote('');
    setError('');
  }, [open, defaultMonth, tenant.paymentCycle]);

  function handleSubmit() {
    const cents = yuanToCents(parseYuanInput(amountYuan));
    if (cents <= 0) {
      setError('请输入有效金额');
      return;
    }
    const usePrepaid = category === 'rent' && isPrepaidCapable && prepaid;
    addPayment({
      tenantId: tenant.id,
      roomId: tenant.roomId ?? '',
      billMonth: month,
      amount: cents,
      category,
      method,
      note: note || undefined,
      ...(usePrepaid
        ? { prepaid: true, periodStart, periodEnd }
        : {}),
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>登记缴费 — {tenant.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="金额（元）"
            type="number"
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            fullWidth
            inputProps={{ step: '0.01', min: 0 }}
          />

          <TextField
            select
            label="缴费类型"
            value={category}
            onChange={(e) => setCategory(e.target.value as PaymentCategory)}
            fullWidth
          >
            {CATEGORY_LABEL.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="归属月份"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />

          {category === 'rent' && isPrepaidCapable && (
            <>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={prepaid}
                    onChange={(e) => setPrepaid(e.target.checked)}
                  />
                }
                label="预收整周期（覆盖下列月份，周期内租金不再计费）"
              />
              {prepaid && (
                <>
                  <TextField
                    label="预收起始月"
                    type="month"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="预收结束月"
                    type="month"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                </>
              )}
            </>
          )}

          <TextField
            label="收款方式"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            fullWidth
            placeholder="现金 / 微信 / 支付宝 / 银行转账"
          />
          <TextField
            label="备注"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit} variant="contained" disableElevation>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default PaymentForm;