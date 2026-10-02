import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置：把 Web 构建产物 (dist) 打包成 Android App（Android Studio 编译）。
 * appId 需与 Android 包名一致（此处 com.landlord.mgmt）。
 */
const config: CapacitorConfig = {
  appId: 'com.landlord.mgmt',
  appName: '房东管理系统',
  webDir: 'dist',
  server: {
    // Android WebView 用 https 方案，便于 IndexedDB / Service Worker 等安全上下文特性
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      // 拍照由 usePhoto 传入 quality / resultType，此处为默认值
    },
    CapacitorUpdater: {
      // 关闭 Capgo 云端的自动更新，改用我们自己的 GitHub Releases 手动流程
      // （见 src/services/otaUpdater.ts + scripts/publish-ota.mjs）
      autoUpdate: 'off',
      // 新包生效后自动清理上一个包，节省手机空间
      autoDeletePrevious: true,
      // 安装新的原生 APK 后，丢弃比原生版本更旧的 OTA 包，避免版本回退
      resetWhenUpdate: true,
    },
  },
};

export default config;