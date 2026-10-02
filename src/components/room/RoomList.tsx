/**
 * RoomList：房间列表 + 房间详情（内含照片画廊）。
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import type { Room } from '../../types';
import { useRoomStore } from '../../store/roomStore';
import { useTenantStore } from '../../store/tenantStore';
import { formatCents } from '../../utils/money';
import { roomStatusLabel } from '../../utils/labels';
import RoomForm from './RoomForm';
import PhotoGallery from './PhotoGallery';
import ConfirmDialog from '../common/ConfirmDialog';

function RoomDetail({ room, onClose }: { room: Room; onClose: () => void }) {
  const tenants = useTenantStore((s) => s.tenants);
  const tenant = tenants.find((t) => t.id === room.tenantId) ?? null;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>{room.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              月租金：{formatCents(room.monthlyRent)} · 状态：{roomStatusLabel(room.status)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              承租人：{tenant ? tenant.name : '空置'}
            </Typography>
          </Box>
          <PhotoGallery roomId={room.id} photoIds={room.photoIds} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export function RoomList() {
  const rooms = useRoomStore((s) => s.rooms);
  const removeRoom = useRoomStore((s) => s.removeRoom);
  const tenants = useTenantStore((s) => s.tenants);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Room | undefined>();
  const [detail, setDetail] = useState<Room | undefined>();
  const [toDelete, setToDelete] = useState<Room | undefined>();

  function openAdd() {
    setEditing(undefined);
    setFormOpen(true);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          房间（{rooms.length}）
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} disableElevation>
          新增房间
        </Button>
      </Box>

      {rooms.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          还没有房间，点击「新增房间」开始。
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {rooms.map((r) => {
            const tenant = tenants.find((t) => t.id === r.tenantId);
            return (
              <Card key={r.id} variant="outlined" onClick={() => setDetail(r)} sx={{ cursor: 'pointer' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <MeetingRoomIcon color="primary" />
                    <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                      {r.name}
                    </Typography>
                    <Chip size="small" label={roomStatusLabel(r.status)} color={r.status === 'rented' ? 'success' : 'default'} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    月租 {formatCents(r.monthlyRent)} · {tenant ? tenant.name : '空置'}
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} justifyContent="flex-end">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditing(r); setFormOpen(true); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); setToDelete(r); }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      <RoomForm open={formOpen} onClose={() => setFormOpen(false)} initial={editing} />

      {detail && <RoomDetail room={detail} onClose={() => setDetail(undefined)} />}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="删除房间"
        content={`确定删除房间「${toDelete?.name ?? ''}」吗？关联租户将变为未关联。`}
        confirmText="删除"
        danger
        onCancel={() => setToDelete(undefined)}
        onConfirm={() => {
          if (toDelete) removeRoom(toDelete.id);
          setToDelete(undefined);
        }}
      />
    </Box>
  );
}

export default RoomList;