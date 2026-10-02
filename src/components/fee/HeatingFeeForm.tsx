/**
 * HeatingFeeForm：供暖费登记/编辑（按房间 + 供暖年）。
 * 状态由「已缴金额 vs 总额」自动推导（已缴/部分/未缴）。
 */
import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import type { HeatingFee, Room, HeatingStatus } from '../../types';
import { useFeeStore } from '../../store/feeStore';
import { parseYuanInput, yuanToCents, formatCents } from '../../utils/money';
import { heatingYearOf, currentMonth } from '../../utils/date';

interface HeatingFeeFormProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  editRecord?: HeatingFee;
}

/** 根据已缴/总额推导状态 */
function deriveStatus(amount: number, paidAmount: number): HeatingStatus {
  if (amount <= 0) return 'unpaid';
  if (paidAmount >= amount) return 'paid';
  if (paidAmount > 0) return 'partial';
  return 'unpaid';
}

export function HeatingFeeForm({ open, onClose, rooms, editRecord }: HeatingFeeFormProps) {
  const saveHeatingFee = useFeeStore((s) => s.saveHeatingFee);
  // 已出租房间（供暖按承租人计）
  const rentedRooms = useMemo(() => rooms.filter((r) => r.status === 'rented'), [rooms]);

  const [roomId, setRoomId] = useState('');
  const [year, setYear] = useState(heatingYearOf(currentMonth()));
  const [amountYuan, setAmountYuan] = useState('');
  const [paidYuan, setPaidYuan] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editRecord) {
      setRoomId(editRecord.roomId);
      setYear(editRecord.year);
      setAmountYuan(String(editRecord.amount / 100));
      setPaidYuan(String(editRecord.paidAmount / 100));
    } else {
      setRoomId(rentedRooms[0]?.id ?? rooms[0]?.id ?? '');
      setYear(heatingYearOf(currentMonth()));
      setAmountYuan('');
      setPaidYuan('0');
    }
    setError('');
  }, [open, editRecord, rentedRooms, rooms]);

  const amount = yuanToCents(parseYuanInput(amountYuan));
  const paidAmount = yuanToCents(parseYuanInput(paidYuan));
  const status = deriveStatus(amount, paidAmount);

  function handleSubmit() {
    if (!roomId) {
      setError('请选择房间');
      return;
    }
    if (amount <= 0) {
      setError('请输入供暖费总额');
      return;
    }
    const room = rentedRooms.find((r) => r.id === roomId);
    if (!room?.tenantId) {
      setError('该房间没有承租人，无法登记供暖费');
      return;
    }
    saveHeatingFee({
      ...(editRecord ? { id: editRecord.id } : {}),
      roomId,
      tenantId: room.tenantId,
      year,
      status,
      amount,
      paidAmount,
      paidDate: paidAmount > 0 ? new Date().toISOString().slice(0, 10) : undefined,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{editRecord ? '编辑供暖费' : '登记供暖费'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            label="房间（已出租）"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            fullWidth
          >
            {rentedRooms.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="供暖年（如 2026 表示 2026-11 至 2027-04 供暖季）"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            fullWidth
          />
          <TextField
            label="供暖费总额（元）"
            type="number"
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            fullWidth
            inputProps={{ step: '0.01', min: 0 }}
          />
          <TextField
            label="已缴金额（元）"
            type="number"
            value={paidYuan}
            onChange={(e) => setPaidYuan(e.target.value)}
            fullWidth
            inputProps={{ step: '0.01', min: 0 }}
          />
          <Alert severity="info">
            状态自动推导：{status === 'paid' ? '已缴' : status === 'partial' ? '部分缴纳' : '未缴'} ·
            总额 {formatCents(amount)} / 已缴 {formatCents(paidAmount)}
          </Alert>
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

export default HeatingFeeForm;