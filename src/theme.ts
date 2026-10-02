import { createTheme } from '@mui/material/styles';

/**
 * 全局 MUI 主题。
 * 移动端优先：主色使用沉稳的蓝色，圆角略大，字体栈含中文字体。
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1565c0',
      dark: '#0d47a1',
      light: '#5e92f3',
    },
    secondary: {
      main: '#ef6c00',
    },
    success: {
      main: '#2e7d32',
    },
    error: {
      main: '#c62828',
    },
    background: {
      default: '#f4f6f8',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    fontSize: 15,
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 10,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 16,
        },
      },
    },
  },
});
