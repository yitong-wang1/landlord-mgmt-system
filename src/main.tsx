import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { router } from './router';
import { theme } from './theme';
import { initOta } from './services/otaUpdater';
import './index.css';

/**
 * 应用入口。
 * - ThemeProvider：MUI 主题（中文优先、移动端配色）。
 * - CssBaseline：统一盒模型与默认样式。
 * - RouterProvider：基于 react-router 的路由。
 */
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('未找到 #root 挂载节点');
}

// 原生 App 内初始化无线更新（notifyAppReady + 后台静默检查）。
// 不阻塞渲染：内部自行 catch 所有异常；浏览器/PWA 下为空操作。
void initOta();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
);
