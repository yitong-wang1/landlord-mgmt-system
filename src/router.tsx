import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { TenantsPage } from './pages/TenantsPage';
import { RoomsPage } from './pages/RoomsPage';
import { FeesPage } from './pages/FeesPage';
import { BillsPage } from './pages/BillsPage';
import { SettingsPage } from './pages/SettingsPage';

/**
 * 路由表（移动端底部导航对应的五个主页面 + 设置）。
 * AppShell 作为布局容器，承载底部导航与页面出口。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'tenants', element: <TenantsPage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'fees', element: <FeesPage /> },
      { path: 'bills', element: <BillsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
