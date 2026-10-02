/**
 * AppShell：整体布局（响应式 + 底部导航 + 启动引导）。
 * 移动端优先：底部 Tab 导航；桌面/平板宽度时自动切为左侧栏。
 */
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import ReceiptIcon from '@mui/icons-material/Receipt';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import SettingsIcon from '@mui/icons-material/Settings';
import HomeWork from '@mui/icons-material/HomeWork';
import { repository } from '../../db/repository';
import { useTenantStore } from '../../store/tenantStore';
import { useRoomStore } from '../../store/roomStore';
import { useFeeStore } from '../../store/feeStore';
import { useBillStore } from '../../store/billStore';

/** 底部导航项定义（路由 path 对应） */
const NAV_ITEMS = [
  { value: '/', label: '首页', icon: <DashboardIcon /> },
  { value: '/tenants', label: '租户', icon: <PeopleIcon /> },
  { value: '/rooms', label: '房间', icon: <MeetingRoomIcon /> },
  { value: '/fees', label: '费用', icon: <ReceiptIcon /> },
  { value: '/bills', label: '账单', icon: <AccountBalanceWalletIcon /> },
  { value: '/settings', label: '设置', icon: <SettingsIcon /> },
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));

  // 启动引导：种子内置费用类型 + 加载各 store
  useEffect(() => {
    repository.ensureSeed();
    useTenantStore.getState().load();
    useRoomStore.getState().load();
    useFeeStore.getState().load();
    useBillStore.getState().load();
  }, []);

  // 当前选中的导航项（首页 '/'）
  const current =
    NAV_ITEMS.find((n) =>
      n.value === '/' ? location.pathname === '/' : location.pathname.startsWith(n.value),
    )?.value ?? '/';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* 桌面/平板：左侧固定导航 */}
      {wide && (
        <Box
          component="nav"
          sx={{
            width: 200,
            flexShrink: 0,
            bgcolor: 'primary.main',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            pt: 2,
          }}
        >
          {NAV_ITEMS.map((item) => (
            <Box
              key={item.value}
              onClick={() => navigate(item.value)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.5,
                py: 1.5,
                cursor: 'pointer',
                bgcolor: current === item.value ? 'primary.dark' : 'transparent',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              {item.icon}
              <Typography variant="body1">{item.label}</Typography>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 顶栏（仅移动端显示标题） */}
        {!wide && (
          <AppBar position="sticky" color="primary" enableColorOnDark>
            <Toolbar variant="dense">
              <HomeWork sx={{ mr: 1 }} />
              <Typography variant="h6" sx={{ flexGrow: 1, fontSize: 18 }}>
                房东出租屋管理
              </Typography>
              <IconButton color="inherit" onClick={() => navigate('/settings')}>
                <SettingsIcon />
              </IconButton>
            </Toolbar>
          </AppBar>
        )}

        {/* 页面内容 */}
        <Box component="main" sx={{ flexGrow: 1, p: wide ? 3 : 1.5, pb: wide ? 3 : 10 }}>
          <Outlet />
        </Box>
      </Box>

      {/* 移动端底部导航 */}
      {!wide && (
        <BottomNavigation
          value={current}
          onChange={(_e, v) => navigate(v)}
          showLabels
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: (t) => t.zIndex.appBar,
            borderTop: '1px solid #e0e0e0',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <BottomNavigationAction key={item.value} label={item.label} value={item.value} icon={item.icon} />
          ))}
        </BottomNavigation>
      )}
    </Box>
  );
}

export default AppShell;