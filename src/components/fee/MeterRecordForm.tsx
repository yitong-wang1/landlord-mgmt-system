/**
 * MeterRecordForm：电表抄表录入（含「拍照录入」）。
 *
 * - 支持「按读数录入」（上期/本期）或「直填用量」。
 * - 拍照录入：照片统一加水印（时间+经纬度）+ SHA-256 哈希，连同 photoId/capturedAt/lat/lng 写入 MeterRecord。
 * - 保存后可在费用页查看带水印照片并做哈希校验。
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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Alert from '@mui/material/Alert';
import type { MeterRecord, Room } from '../../types';
import { useFeeStore } from '../../store/feeStore';
import PhotoUpload, { type EvidencePhotoValue } from '../common/PhotoUpload';
import { currentMonth } from '../../utils/date';

interface MeterRecordFormProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  /** 默认房间 */
  defaultRoomId?: string;
  /** 默认月份 */
  defaultMonth?: string;
  /** 编辑既有记录时传入 */
  editRecord?: MeterRecord;
}

type InputMode = 'reading' | 'usage';

export function MeterRecordForm({
  open,
  onClose,
  rooms,
  defaultRoomId,
  defaultMonth,
  editRecord,
}: MeterRecordFormProps) {
  const saveMeterRecord = useFeeStore((s) => s.saveMeterRecord);

  const [roomId, setRoomId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [mode, setMode] = useState<InputMode>('reading');
  const [prevReading, setPrevReading] = useState('');
  const [currReading, setCurrReading] = useState('');
  const [usage, setUsage] = useState('');
  const [photo, setPhoto] = useState<EvidencePhotoValue | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editRecord) {
      setRoomId(editRecord.roomId);
      setMonth(editRecord.month);
      setPrevReading(editRecord.prevReading != null ? String(editRecord.prevReading) : '');
      setCurrReading(editRecord.currReading != null ? String(editRecord.currReading) : '');
      setUsage(String(editRecord.usage ?? 0));
      setMode(editRecord.currReading != null ? 'reading' : 'usage');
      setPhoto(
        editRecord.photoId
          ? {
              photoId: editRecord.photoId,
              photoHash: editRecord.photoHash ?? '',
              capturedAt: editRecord.capturedAt ?? editRecord.recordedAt,
              lat: editRecord.lat ?? null,
              lng: editRecord.lng ?? null,
            }
          : null,
      );
    } else {
      setRoomId(defaultRoomId ?? rooms[0]?.id ?? '');
      setMonth(defaultMonth ?? currentMonth());
      setMode('reading');
      setPrevReading('');
      setCurrReading('');
      setUsage('');
      setPhoto(null);
    }
    setError('');
  }, [open, editRecord, defaultRoomId, defaultMonth, rooms]);

  // 按读数模式实时计算用量
  const computedUsage = useMemo(() => {
    if (mode === 'usage') return Number(usage) || 0;
    const p = Number(prevReading);
    const c = Number(currReading);
    if (Number.isFinite(p) && Number.isFinite(c) && prevReading !== '' && currReading !== '') {
      return Math.max(0, c - p);
    }
    return 0;
  }, [mode, prevReading, currReading, usage]);

  function handleSubmit() {
    if (!roomId) {
      setError('请选择房间');
      return;
    }
    if (!month) {
      setError('请选择月份');
      return;
    }
    const finalUsage = computedUsage;
    saveMeterRecord({
      ...(editRecord ? { id: editRecord.id } : {}),
      roomId,
      month,
      prevReading: mode === 'reading' && prevReading !== '' ? Number(prevReading) : undefined,
      currReading: mode === 'reading' && currReading !== '' ? Number(currReading) : undefined,
      usage: finalUsage,
      photoId: photo?.photoId,
      photoHash: photo?.photoHash,
      capturedAt: photo?.capturedAt,
      lat: photo?.lat ?? undefined,
      lng: photo?.lng ?? undefined,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>{editRecord ? '编辑抄表记录' : '电表抄表录入'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            select
            label="房间"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            fullWidth
          >
            {rooms.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="月份"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />

          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_e, v) => v && setMode(v as InputMode)}
            size="small"
            fullWidth
          >
            <ToggleButton value="reading">按读数</ToggleButton>
            <ToggleButton value="usage">直填用量</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'reading' ? (
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="上期读数"
                type="number"
                value={prevReading}
                onChange={(e) => setPrevReading(e.target.value)}
                fullWidth
                inputProps={{ step: '0.01' }}
              />
              <TextField
                label="本期读数"
                type="number"
                value={currReading}
                onChange={(e) => setCurrReading(e.target.value)}
                fullWidth
                inputProps={{ step: '0.01' }}
              />
            </Stack>
          ) : (
            <TextField
              label="用量（度）"
              type="number"
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              fullWidth
              inputProps={{ step: '0.01', min: 0 }}
            />
          )}

          <Alert severity={computedUsage > 0 ? 'success' : 'info'}>
            本月用量：{computedUsage} 度
          </Alert>

          <PhotoUpload
            label="电表照片（拍照录入，水印防伪）"
            value={photo}
            onChange={setPhoto}
            hint="拍照自动叠加「时间 + 经纬度」水印并计算 SHA-256，原图不留存。"
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

export default MeterRecordForm;