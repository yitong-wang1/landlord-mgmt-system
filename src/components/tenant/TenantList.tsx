/**
 * TenantList：租户列表（新增/编辑/删除/查看详情）。
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Fab from '@mui/material/Fab';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import { useTenantStore } from '../../store/tenantStore';
import { useRoomStore } from '../../store/roomStore';
import type { Tenant } from '../../types';
import TenantCard from './TenantCard';
import TenantForm from './TenantForm';
import TenantDetail from './TenantDetail';
import ConfirmDialog from '../common/ConfirmDialog';

export function TenantList() {
  const tenants = useTenantStore((s) => s.tenants);
  const removeTenant = useTenantStore((s) => s.removeTenant);
  const rooms = useRoomStore((s) => s.rooms);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | undefined>();
  const [detail, setDetail] = useState<Tenant | undefined>();
  const [toDelete, setToDelete] = useState<Tenant | undefined>();

  function openAdd() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(t: Tenant) {
    setEditing(t);
    setFormOpen(true);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          租户（{tenants.length}）
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd} disableElevation>
          新增租户
        </Button>
      </Box>

      {tenants.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          还没有租户，点击「新增租户」开始。
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {tenants.map((t) => {
            const room = rooms.find((r) => r.id === t.roomId);
            return (
              <TenantCard
                key={t.id}
                tenant={t}
                roomName={room?.name}
                onOpen={() => setDetail(t)}
                onEdit={() => openEdit(t)}
                onDelete={() => setToDelete(t)}
              />
            );
          })}
        </Box>
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 76, right: 16 }}
        onClick={openAdd}
        aria-label="新增租户"
      >
        <AddIcon />
      </Fab>

      <TenantForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={editing}
        rooms={rooms}
      />

      {detail && (
        <TenantDetail
          open
          onClose={() => setDetail(undefined)}
          tenant={detail}
          room={rooms.find((r) => r.id === detail.roomId)}
          onDelete={() => {
            // 先关详情，再弹确认框（确认框层级在最后，避免被对话框遮挡）
            const target = detail;
            setDetail(undefined);
            setToDelete(target);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="删除租户"
        content={`确定删除租户「${toDelete?.name ?? ''}」吗？\n\n· 其占用的房间会自动释放为空置；\n· 已产生的账单与缴费记录会保留（用于对账）。\n\n此操作不可撤销。`}
        confirmText="删除"
        danger
        onCancel={() => setToDelete(undefined)}
        onConfirm={() => {
          if (toDelete) removeTenant(toDelete.id);
          setToDelete(undefined);
        }}
      />
    </Box>
  );
}

export default TenantList;