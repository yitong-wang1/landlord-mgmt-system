/**
 * TenantCard：租户列表卡片（脱敏展示身份证）。
 */
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import PersonIcon from '@mui/icons-material/Person';
import DeleteIcon from '@mui/icons-material/Delete';
import type { Tenant } from '../../types';
import { maskIdCard, maskPhone } from '../../utils/mask';
import { formatCents } from '../../utils/money';
import { cycleLabel } from '../../services/billingEngine';

interface TenantCardProps {
  tenant: Tenant;
  roomName?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function TenantCard({ tenant, roomName, onOpen, onEdit, onDelete }: TenantCardProps) {
  return (
    <Card variant="outlined" onClick={onOpen} sx={{ cursor: 'pointer' }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar sx={{ bgcolor: 'primary.light' }}>
            <PersonIcon />
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {tenant.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {maskIdCard(tenant.idCard) || '未填身份证'} · {maskPhone(tenant.phone) || '无电话'}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={cycleLabel(tenant.paymentCycle)} />
              <Chip
                size="small"
                variant="outlined"
                label={
                  typeof tenant.depositAmount === 'number' && tenant.depositAmount > 0
                    ? `押金${formatCents(tenant.depositAmount)}`
                    : `押金${tenant.depositMonths}月`
                }
              />
              {roomName && <Chip size="small" label={roomName} variant="outlined" />}
            </Stack>
          </Box>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Button size="small" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
              编辑
            </Button>
            <IconButton
              size="small"
              color="error"
              aria-label="删除租户"
              title="删除租户"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default TenantCard;