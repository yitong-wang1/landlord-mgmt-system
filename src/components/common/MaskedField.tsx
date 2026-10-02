/**
 * MaskedField：身份证等敏感字段的脱敏展示组件。
 * 内部统一调用 utils/mask，默认以脱敏形态展示（如 110***********1234），可点眼睛切换明文。
 */
import { useState } from 'react';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Visibility from '@mui/icons-material/Visibility';
import { maskIdCard } from '../../utils/mask';

interface MaskedFieldProps {
  label?: string;
  /** 身份证明文（组件内部脱敏） */
  value?: string;
  /** 已脱敏的字符串（若直接存了脱敏值可传此 prop） */
  masked?: string;
  disabled?: boolean;
}

export function MaskedField({
  label = '身份证号',
  value,
  masked,
  disabled,
}: MaskedFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const display = masked || maskIdCard(value ?? '');

  return (
    <TextField
      fullWidth
      label={label}
      value={revealed ? (value ?? '') : display}
      disabled={disabled}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              edge="end"
              size="small"
              onClick={() => setRevealed((r) => !r)}
              disabled={disabled}
              aria-label={revealed ? '隐藏' : '显示'}
            >
              {revealed ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

export default MaskedField;