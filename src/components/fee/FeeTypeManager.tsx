/**
 * FeeTypeManager：自定义费用管理。
 *
 * - 自定义费用 = 固定月金额（billingMode='fixed'）+ 作用范围 scope（tenant/room/global）。
 * - 作用目标 appliesTo：为空表示「该 scope 下全部」（可一键「应用到全部租户/房间」）。
 * - 内置费用（租金/电费/供暖）只读展示，不可删除。
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputAdornment from '@mui/material/InputAdornment';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PublicIcon from '@mui/icons-material/Public';
import type { FeeType, FeeScope, Room, Tenant } from '../../types';
import { useFeeStore } from '../../store/feeStore';
import { parseYuanInput, yuanToCents, formatCents } from '../../utils/money';
import { feeScopeLabel, feeCategoryLabel } from '../../utils/labels';
import ConfirmDialog from '../common/ConfirmDialog';

interface FeeTypeManagerProps {
  rooms: Room[];
  tenants: Tenant[];
}

export function FeeTypeManager({ rooms, tenants }: FeeTypeManagerProps) {
  const feeTypes = useFeeStore((s) => s.feeTypes);
  const addFeeType = useFeeStore((s) => s.addFeeType);
  const updateFeeType = useFeeStore((s) => s.updateFeeType);
  const removeFeeType = useFeeStore((s) => s.removeFeeType);
  const applyCustomFeeToAll = useFeeStore((s) => s.applyCustomFeeToAll);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeeType | undefined>();
  const [toDelete, setToDelete] = useState<FeeType | undefined>();

  // form state
  const [name, setName] = useState('');
  const [scope, setScope] = useState<FeeScope>('global');
  const [amountYuan, setAmountYuan] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [error, setError] = useState('');

  function openAdd() {
    setEditing(undefined);
    setName('');
    setScope('global');
    setAmountYuan('');
    setTargets([]);
    setError('');
    setOpen(true);
  }

  function openEdit(f: FeeType) {
    setEditing(f);
    setName(f.name);
    setScope(f.scope ?? 'global');
    setAmountYuan(String((f.fixedAmount ?? 0) / 100));
    setTargets(f.appliesTo ?? []);
    setError('');
    setOpen(true);
  }

  function handleSubmit() {
    if (!name.trim()) {
      setError('请填写费用名称');
      return;
    }
    const fixedAmount = yuanToCents(parseYuanInput(amountYuan));
    if (fixedAmount <= 0) {
      setError('请输入固定月金额');
      return;
    }
    const payload = {
      name: name.trim(),
      category: 'custom' as const,
      isBuiltin: false,
      scope,
      billingMode: 'fixed' as const,
      fixedAmount,
      appliesTo: targets,
    };
    if (editing) {
      updateFeeType(editing.id, payload);
    } else {
      addFeeType(payload);
    }
    setOpen(false);
  }

  const builtins = feeTypes.filter((f) => f.isBuiltin);
  const customs = feeTypes.filter((f) => !f.isBuiltin);

  function targetSummary(f: FeeType): string {
    const list = f.appliesTo ?? [];
    if (list.length === 0) return `全部（${feeScopeLabel(f.scope ?? 'global')}）`;
    if (f.scope === 'tenant') {
      return `指定租户（${list.length}）`;
    }
    if (f.scope === 'room') {
      return `指定房间（${list.length}）`;
    }
    return '全部';
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        费用类型
      </Typography>

      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        内置费用
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        {builtins.map((f) => (
          <Chip key={f.id} label={`${f.name}（${feeCategoryLabel(f.category)}）`} />
        ))}
      </Stack>

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          自定义固定费用
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openAdd} disableElevation variant="contained">
          新增自定义费用
        </Button>
      </Box>

      {customs.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          暂无自定义费用。新增后按固定月金额计入账单。
        </Typography>
      )}

      <Stack spacing={1} sx={{ mb: 2 }}>
        {customs.map((f) => (
          <Card key={f.id} variant="outlined">
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1}>
                {f.scope === 'global' && <PublicIcon fontSize="small" color="action" />}
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="subtitle2">{f.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {feeScopeLabel(f.scope ?? 'global')} · {targetSummary(f)} · {formatCents(f.fixedAmount ?? 0)}/月
                  </Typography>
                </Box>
                {(f.appliesTo ?? []).length > 0 && (
                  <Button
                    size="small"
                    onClick={() => applyCustomFeeToAll(f.id)}
                  >
                    应用到全部
                  </Button>
                )}
                <IconButton size="small" onClick={() => openEdit(f)}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => setToDelete(f)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* 新增/编辑对话框 */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? '编辑自定义费用' : '新增自定义费用'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="费用名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              placeholder="如：垃圾清运费 / 物业费"
            />
            <TextField
              select
              label="作用范围"
              value={scope}
              onChange={(e) => setScope(e.target.value as FeeScope)}
              fullWidth
            >
              <MenuItem value="global">全局（所有租户/房间）</MenuItem>
              <MenuItem value="tenant">按租户</MenuItem>
              <MenuItem value="room">按房间</MenuItem>
            </TextField>
            <TextField
              label="固定月金额（元）"
              type="number"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              fullWidth
              inputProps={{ step: '0.01', min: 0 }}
              InputProps={{
                startAdornment: <InputAdornment position="start">¥</InputAdornment>,
              }}
            />

            {scope !== 'global' && (
              <FormControl fullWidth>
                <InputLabel id="targets-label">指定目标（不选=全部）</InputLabel>
                <Select
                  labelId="targets-label"
                  multiple
                  value={targets}
                  onChange={(e) =>
                    setTargets(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)
                  }
                  input={<OutlinedInput label="指定目标（不选=全部）" />}
                  renderValue={(sel) =>
                    (sel as string[]).length === 0 ? '全部' : `已选 ${(sel as string[]).length} 个`
                  }
                >
                  {(scope === 'tenant' ? tenants : rooms).map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      <ListItemText primary={t.name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <Alert severity="info">
              不选目标 = 应用于该范围内全部。
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disableElevation>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="删除自定义费用"
        content={`确定删除「${toDelete?.name ?? ''}」吗？相关账单将不再包含该项。`}
        confirmText="删除"
        danger
        onCancel={() => setToDelete(undefined)}
        onConfirm={() => {
          if (toDelete) removeFeeType(toDelete.id);
          setToDelete(undefined);
        }}
      />
    </Box>
  );
}

export default FeeTypeManager;