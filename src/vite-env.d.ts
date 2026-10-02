/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时由 vite.config.ts 的 define 注入（值来自 package.json 的 version） */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** OTA 更新源：GitHub 仓库，格式 "owner/repo"。留空则关闭 OTA。 */
  readonly VITE_OTA_REPO?: string;
  /** OTA 更新包在 Release 中的附件名，默认 dist.zip */
  readonly VITE_OTA_ASSET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
