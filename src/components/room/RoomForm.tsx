/**
 * RoomForm：新增/编辑房间对话框（名称 + 月租金）。
 * 房间状态由是否关联租户自动推导（rented/vacant）。
 */
import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import type { Room } from '../../types';
import { useRoomStore } from '../../store/roomStore';
import { parseYuanInput, yuanToCents } from '../../utils/money';

interface RoomFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Room;
}

export function RoomForm({ open, onClose, initial }: RoomFormProps) {
  const addRoom = useRoomStore((s) => s.addRoom);
  const updateRoom = useRoomStore((s) => s.updateRoom);

  const [name, setName] = useState('');
  const [rentYuan, setRentYuan] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setRentYuan(String(initial.monthlyRent / 100));
    } else {
      setName('');
      setRentYuan('');
    }
    setError('');
  }, [open, initial]);

  function handleSubmit() {
    if (!name.trim()) {
      setError('请填写房间名/编号');
      return;
    }
    const monthlyRent = yuanToCents(parseYuanInput(rentYuan));
    if (initial) {
      updateRoom(initial.id, { name: name.trim(), monthlyRent });
    } else {
      addRoom({ name: name.trim(), monthlyRent, status: 'vacant', photoIds: [] });
    }
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑房间' : '新增房间'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <TextField
          label="房间名称/编号"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          sx={{ mt: 1 }}
          autoFocus
        />
        <TextField
          label="月租金（元）"
          type="number"
          value={rentYuan}
          onChange={(e) => setRentYuan(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
          inputProps={{ step: '1', min: 0 }}
        />
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

export default RoomForm;