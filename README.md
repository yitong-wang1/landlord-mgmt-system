# 房东出租屋管理系统（移动端 PWA / Android App）

一个手机优先的房东出租屋管理工具：租户、房间、抄表（水电）、供暖、押金、账单与催缴、备份恢复，**全部数据保存在本机**，无后端、无云端。

- 技术栈：Vite + React 18 + TypeScript + MUI + Tailwind + vite-plugin-pwa
- 状态：Zustand；存储：localStorage（结构化数据）+ IndexedDB（照片 Blob）
- 两种形态：**浏览器 PWA** 与 **Android App（Capacitor 打包，用 Android Studio 编译）**

---

## 功能清单

| 模块 | 能力 |
|------|------|
| 租户 | 新增/编辑/**删除**（卡片与详情页均可删除，带影响面确认）；姓名、手机号；身份证（**拍照一次完成：OCR 识别姓名 + 号码 + 可选留存证件照 + 明文存储 + 脱敏展示**）；缴费周期（月付/季付/年付）；押金**月数与金额**（金额可按房间租金自动计算或手工指定）+ 可退/抵扣 + 退租是否可扣款；关联房间（1:1） |
| 房间 | 新增/编辑；月租金；状态（空置/已出租）自动推导；房间照片画廊（水印照片） |
| 电费 | 每月抄表（按读数或直填用量）；**拍照录入**（带水印 + SHA-256）；金额 = 用量 × 单价（单价在设置页配置） |
| 供暖费 | 按房间 + 供暖年登记；总额/已缴金额；状态（已缴/未缴/部分）自动推导；剩余额按供暖季分摊到各月账单 |
| 自定义费用 | 固定月金额；作用范围 `global/tenant/room`；可指定目标，或一键「应用到全部租户/房间」 |
| 账单 | 按月自动算账（租金 + 电费 + 供暖 + 自定义）；应收/已缴/欠费；状态（已结清/欠费/部分）；季付/年付**预收整周期**抵扣 |
| 缴费 | 登记租金/押金/其他；季付/年付可「预收整周期」覆盖起止月；押金用 `category=deposit` |
| 催缴 | 欠费名单；一键生成催缴文案（可复制）；导出账单 CSV |
| 设置 | 电价、房东署名；备份导出/恢复（全量含照片 / 轻量无照片）；相机与定位权限、自动对时提示 |
| 备份 | 全量 JSON（含照片 base64）与轻量 JSON；导入校验并还原 |
| 更新 | **无线 OTA**（可选）：GitHub Releases 托管，启动自动检查网页层更新；设置页可手动检查。原生层改动仍需重编 APK（见「运行方式 C」） |

---

## 相机 / 定位权限与「水印 + 哈希」防篡改

这是本系统的取证能力，**电表照片与证件照统一处理**：

1. 拍照瞬间取**本机时钟**时间 + **GPS 经纬度**（`navigator.geolocation`；失败则水印标注「定位不可用」）。
2. 用 Canvas 在图片底部叠加可读水印：`拍摄时间：YYYY-MM-DD HH:mm:ss` 与 `位置：31.2304°N, 121.4737°E`（**原图不留存，只保存带水印版本**）。
3. 用 Web Crypto **SHA-256** 计算「带水印图片」的哈希，连同拍摄时间戳/经纬度一起存入记录（`MeterRecord.photoHash/capturedAt/lat/lng`，租户证件照同理）。
4. 详情页/费用页提供「校验」按钮：重新计算哈希与记录比对，验证图片未被替换。

> ⚠️ **重要提示**：水印时间取自**本机时钟**（未联网校时）。请务必开启手机「**自动对时 / 自动设置时间**」，并允许本应用使用「**相机**」和「**精确位置/粗略位置**」权限，否则水印时间可能不准、定位显示为「定位不可用」。这些提示同时内置在 App 的「设置 → 相机与定位权限 / 时间准确性」页面。

## 身份证 OCR（姓名 + 身份证号）与证件照

**拍照一次，完成两件事**（入口只有一个，不再区分"识别"和"证件照"两次拍照）：

1. 对**原图**做端侧 OCR → 自动回填**姓名**与**身份证号**；
2. 若勾选了「同时留存证件照」→ 同一张照片叠加「时间 + 经纬度」水印并计算 SHA-256 后存入该租户档案；**未勾选则只识别、不留任何照片**。

### 取景框：只识别框内内容

- 取景画面上有**身份证比例的白色取景框**，框外压暗。**只有框内区域参与识别**，框外背景一律不识别。
- 作用：裁掉背景后证件在画面中占比大幅提升，小字识别率明显变好。
- 框的位置按身份证标准比例（85.6 : 54）设计，见 `TenantForm.tsx` 的 `ID_CARD_FRAME`。
- 容器坐标 → 视频像素的换算由纯函数 `mapCoverCrop`（`src/hooks/useCamera.ts`）完成，并有 6 个单测覆盖（含越界、极端比例、退化尺寸），避免裁到错误区域。
- 从**相册选图**时按整幅识别（不套用取景框）——相册里的图通常已是证件本身，硬裁反而可能切掉边缘。
- 原生端优先使用**应用内自绘取景器**（系统相机无法叠加取景框）；若 WebView 内取景不可用，会自动回退系统相机并在提示中说明本次未套用取景框。

其他要点：

- **识别两个字段**：姓名与身份证号；已手工填写的字段不会被静默覆盖，只提示识别到的值供你核对。
- **姓名解析做了排版容错**：能处理「姓名张三性别男」这类与后续字段粘连、姓名字间带空格、全角空格、中文/半角冒号、复姓四字名、「姓」「名」分成两行等情况（见 `src/ocr/idCardOCR.ts` 的 `parseName`）。
- **两遍识别**：首遍没取到姓名但确实读到了中文时，会换「单块版面」(PSM 6) 再识别一次——身份证是多列排版（文字 + 照片），不同切分方式结果差异很大，这一步能救回不少姓名。
- **OCR 前图像增强**（`enhanceForOcr`）：先把图片放大到 1800px 宽、转灰度、按 2%~98% 分位做对比度拉伸。证件上的小字在原始分辨率下只有十几像素高时，Tesseract 会"编"出毫不相干的字（实测把「王艺潼」读成「二痊别」），这一步显著改善小字识别。
- **拍照必须高分辨率**：浏览器/WebView 取景会显式请求 2560×1440（不指定时浏览器常默认 640×480，证件小字必糊）。识别结果里会带回原图宽度，**低于 1000px 会明确提示**分辨率不足、建议靠近重拍或改用「上传图片」选高清原图。
- **兜底规则**：即使「姓名」标签被 OCR 认花，也会按版式位置找「紧邻性别/民族/出生/住址的 2~4 字中文」作为姓名候选。
- **识别不出来时能自查**：识别失败会提示原因，并提供「**查看识别原文**」按钮——可以看到 OCR 到底读到了什么文字（区分"中文语言包没加载"和"读到了但没定位到姓名"两种失败）。
- **身份证号容错**：号码中夹入空格/连字符等噪声也能拼回，末位 `x` 自动规范为大写 `X`。
- **端侧识别**：Tesseract.js 在手机本地运行，证件图片不出本机；失败自动降级为手动录入。
- **取消勾选会真正移除**：编辑租户时取消「留存证件照」并保存，档案里已存的证件照记录会被清除（不会残留）。

## 删除租户

- 租户**卡片**右侧的垃圾桶图标、或**租户详情**页左下角「删除租户」，均可发起删除。
- 删除前弹确认框，明确列出影响面：占用的房间会**释放为空置**；已产生的**账单与缴费记录保留**（用于对账）；**此操作不可撤销**。
- 删除后房间状态、账单等会立即同步刷新（见 `src/store/sync.ts` 的跨 store 同步）。

## 押金（月数 + 金额）

- **押金月数**：约定收几个月。
- **押金金额**：实际收取的金额（元）。关联房间后会自动按「月数 × 房间月租金」填入建议值；也可手工改成实际金额（例如谈好了整数）。手工填写后不再被自动覆盖，另有「按…重算」按钮可恢复自动计算。
- **为何同时存金额**：押金是签约时约定的固定金额，把金额固化下来，日后调整房租也不会改变已约定押金的金额口径。未填金额的老数据，展示自动回退为「押金 N 个月」。
- 押金**不计入**月度账单的应收/已缴，仅在「缴纳」中以 `category=deposit` 单独记录，避免污染账目。

**隐私说明**：身份证按**明文**存储于本机（产品决策，不做 AES 加密），但所有**展示**统一经 `maskIdCard` 脱敏为 `110***********1234`（见 `src/utils/mask.ts` 与 `MaskedField` 组件）。照片仅存本机（IndexedDB），不上传服务器。端侧 OCR（Tesseract.js）不出本机。

---

## 运行方式 A：浏览器 / PWA

```bash
npm install     # 安装依赖
npm run dev     # 本地开发（默认 http://localhost:5173）
npm run build   # 生产构建（含 TypeScript 类型检查），产物在 dist/
npm run preview # 预览生产构建
```

> 构建校验：`npm run build` 会先跑 `tsc` 类型检查，零错误才产出。

### 把 PWA 装到手机（添加到主屏幕）

1. 用手机浏览器打开部署后的站点（HTTPS 或 localhost）。
2. **Android Chrome**：菜单 → 「安装应用 / 添加到主屏幕」。
3. **iPhone Safari**：分享 → 「添加到主屏幕」。
4. 装好后从桌面图标启动，全屏、无地址栏，拍照/定位在安装后按提示授权即可。

---

## 运行方式 B：Android Studio 编译成 Android App

工程采用 **Capacitor** 复用现有 Web 代码（appId `com.landlord.mgmt`，appName「房东管理系统」）。Android 原生工程已生成在 `android/` 目录。

### 前置准备

1. **构建 Web 产物**（Capacitor 需要 `dist/`）：
   ```bash
   npm install
   npm run build
   ```
2. **同步 Web 资源到原生工程**（把 `dist/` 拷入 `android/app/src/main/assets/public/`）：
   ```bash
   npx cap sync android     # 同步资源 + 安装 @capacitor/camera 插件
   # 若同步被环境删除保护拦截，可只拷资源：
   npx cap copy android
   ```
   > 改了 Web 代码后，重新 `npm run build` 再 `npx cap sync android`（或 `cap copy android`）。

### 用 Android Studio 打开并编译

1. 打开 Android Studio → **File → Open**，选择项目里的 **`android/` 目录**（`landlord-mgmt-system/android`），点 OK。Android Studio 会把它当作 Gradle 工程打开。
2. **等待 Gradle 同步**（右下角进度条）。首次会自动下载 Gradle、Android Gradle Plugin 与依赖，需要联网并耐心等待。
3. 若提示缺少 **Android SDK**：在 `Tools → SDK Manager` 安装 **Android SDK Platform 36**（对应 `compileSdk/targetSdk 36`）与 Build-Tools；若你的环境 SDK 较低，可在 `android/variables.gradle` 里把 `compileSdkVersion/targetSdkVersion` 调低。
4. 编译 **Build → Build Bundle(s)/APK(s) → Build APK(s)**（调试包）。
5. 产物路径：
   - 调试包：`android/app/build/outputs/apk/debug/app-debug.apk`
   - 发布包：用 **Build → Generate Signed App Bundle / APK** 选择签名后输出到 `android/app/build/outputs/apk/release/`（或 bundle）。

### 真机安装 / 调试

```bash
# 调试包安装到已连接的手机
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
# 或覆盖安装
adb install -r -d android/app/build/outputs/apk/debug/app-debug.apk
```

### 模拟器开启定位权限（测 GPS 水印）

- **Android Studio**：运行模拟器 → 右侧 **Extended Controls**（扩展控制）→ **Location** → 填入经纬度（如 `31.2304, 121.4737`，顺序为 纬度, 经度）→ 点击 **Send**。
- 或命令行：`adb emu geo fix 121.4737 31.2304`（参数顺序：经度 纬度）。
- 模拟器首次使用相机/定位会弹权限对话框，点「允许」。真机同理（相机、精确位置）。

### Android 权限说明

已在 `android/app/src/main/AndroidManifest.xml` 声明并在运行时按需申请：

- `android.permission.CAMERA`（拍摄证件照/电表照片）
- `android.permission.ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION`（水印经纬度）

拍照主通道优先用 **@capacitor/camera** 原生插件（`usePhoto` 自动检测原生环境），浏览器端回退 `getUserMedia`；两条通道拿到的图片都会经过同一套「水印 + SHA-256」处理。

---

## 备份与恢复

- **数据位置**：结构化数据（租户/房间/费用/缴费/账单/设置）→ `localStorage`；照片（带水印 Blob）→ `IndexedDB`。全部在本机。
- **设置页**提供四种操作：
  - **导出全量（含照片）**：生成 `landlord-backup-YYYYMMDD-HHmm.json`，照片以 base64 内嵌。
  - **导出轻量（无照片）**：仅结构化数据，体积小。
  - **恢复全量 / 恢复轻量**：选择备份 JSON，校验 schema 后覆盖还原（恢复全量会先清空再写回照片），完成后自动刷新。
- **账单导出**：账单页 →「催缴」→ 「导出账单 CSV」（Excel 可直接打开）。
- 建议定期导出全量备份；换设备/重装时用「恢复全量」还原。

---

## 运行方式 C（可选）：无线 OTA 更新

装到手机上的 APK，**不必每次改代码都重新编译安装**——网页层（界面、账单逻辑等）可以通过 OTA 无线推送。

### 能力边界（重要）

| 改动类型 | 能否 OTA |
|---------|---------|
| 界面、页面布局、账单/费用逻辑、水印算法（`src/` 里的代码） | ✅ 可以，无需重装 |
| 权限、新增原生插件、`AndroidManifest`、包名/图标 | ❌ 必须重新编译 APK |
| 本机数据（localStorage / IndexedDB） | ✅ 不受影响，升级后数据仍在 |

原理：Capacitor App 是「原生壳 + 网页内容」，OTA 只替换网页内容。Google Play / App Store 均**明确允许**更新 JS/HTML/CSS（不涉及原生代码）。

### 一次性配置

1. **建一个 GitHub 仓库**（必须 **Public**；私有仓库需 token 才能读 Release，OTA 会失效），把本项目推送上去。
2. 复制配置模板并填写：
   ```bash
   cp .env.example .env
   ```
   编辑 `.env`（只有 `VITE_OTA_REPO` 是必填）：
   ```ini
   VITE_OTA_REPO=你的用户名/你的仓库名      # App 端据此检查更新（必填）
   VITE_OTA_ASSET=dist.zip
   GITHUB_TOKEN=                          # 仅「自动发布」需要，手动发布可留空
   ```
   `.env` 已被 `.gitignore` 忽略。**注意**：`GITHUB_TOKEN` 没有 `VITE_` 前缀，因此不会被 Vite 注入前端产物（只有 `VITE_` 开头的变量才会暴露给客户端）。
3. **重新构建并同步**（把 OTA 配置打进 App）：
   ```bash
   npm run build
   npx cap sync android
   ```
   然后用 Android Studio 重新编译**一次** APK 装上（这是最后一次必须重装，之后即可走 OTA）。

> `.env` 里的 `VITE_OTA_REPO` 是在**构建时**注入 App 的，所以改了这个值必须重新 build + 重装一次 APK。

### 发布一次更新

**方式一：手动发布（默认，无需 token）**

1. 改完代码后提升版本号（版本号来自 `package.json`，必须**大于手机上已装的版本**才会触发更新）：
   ```bash
   npm version patch     # 1.0.0 → 1.0.1
   ```
2. 打包（会构建 + 生成 `dist.zip` 与 `dist.zip.sha256`，并打印上传指引）：
   ```bash
   npm run ota:pack
   ```
3. 按终端打印的指引操作：打开
   `https://github.com/你的用户名/你的仓库名/releases/new`
   → Tag 填 `v1.0.1` → 把 `dist.zip`、`dist.zip.sha256` 拖进 **Attach binaries** → **Publish release**。

> 脚本会自动检查该 tag 是否已存在；若已存在会警告你版本号没升（同版本重发不会触发更新）。

**方式二：自动发布（需一次性配置 `GITHUB_TOKEN`）**

在 https://github.com/settings/tokens 生成经典 token（勾 `repo`）填进 `.env`，之后：
```bash
npm version patch
npm run ota:publish
```
脚本会：构建 → 打包 `dist.zip` → 计算 sha256 → 创建 Release → 上传两个附件（走 GitHub REST API，不依赖 `gh` 命令）。

**更新生效**：手机 App **下次启动时自动检查**最新 Release，发现新版本就下载并应用（应用会重启一次）。也可在 App 内 **设置 → 软件更新 → 检查更新** 手动触发。

### 说明与限制

- **更新包约 30MB**：因为离线中文 OCR 语言包（约 20MB）与 wasm 核心也需一并打进更新包。个人使用、更新不频繁时可接受；若追求小包，可参考社区方案把 OCR 资源改为 CDN 托管，或改用 Capgo 云服务的**增量更新**（只下载变更文件）。
- **需要联网**：检查与下载均需网络；离线时静默跳过，不影响使用。
- **自动回滚**：若新版本启动失败，插件会自动回滚到上一个可用版本（依赖启动时的 `notifyAppReady()`，已在 `main.tsx` 中调用）。
- **校验**：发布时生成的 `dist.zip.sha256` 会在下载时作为 `checksum` 传入，确保更新包完整未被篡改。
- **浏览器 / PWA 方式不需要此功能**：Service Worker 会自动更新页面。

相关文件：`src/services/otaUpdater.ts`（检查/下载/应用逻辑）、`scripts/publish-ota.mjs`（发布脚本）、`.env.example`（配置模板）。

---

## 目录结构（分层单向依赖）

```
src/
├── types/index.ts        全部核心类型/枚举
├── db/                   存储抽象层
│   ├── localStore.ts       localStorage 封装
│   ├── photoDB.ts          IndexedDB 照片 Blob
│   └── repository.ts       统一数据访问（预留云端同步 seam）
├── services/             业务服务
│   ├── billingEngine.ts    费用引擎（月/季/年付 + 预收抵扣）
│   ├── billGenerator.ts    账单聚合（应收/已缴/欠费）
│   ├── backup.ts           导出/导入备份
│   └── otaUpdater.ts       无线 OTA 更新（GitHub Releases）
├── ocr/idCardOCR.ts      端侧 Tesseract 身份证 OCR（辅助录入）
├── utils/                工具（money/date/mask/format/crypto/watermark/labels）
├── hooks/                useCamera / useOCR / usePhoto
├── components/           layout / tenant / room / fee / bill / common
└── pages/                Dashboard/Tenants/Rooms/Fees/Bills/Settings
```

依赖方向：**UI → Store(Zustand) → Service → Repository → 存储**。store 只调 repository，不直接碰存储。

---

## OCR 离线资源（tesseract）

为让 Android WebView 在**离线/内网**也能识别身份证，已把 Tesseract 的 worker 与 wasm 核心放到 `public/tesseract/`，并在 `src/ocr/idCardOCR.ts` 中优先加载本地路径、失败自动回退 CDN：

```bash
node scripts/fetch-tesseract-assets.mjs   # 复制 worker/wasm，并尝试下载中文语言包
```

- **中文语言包** `chi_sim.traineddata.gz` 体积大（约 20MB）。脚本会尝试下载；若网络受限失败：
  - 在线环境会自动回退 CDN，OCR 正常；
  - 离线环境请手动放置到 `public/tesseract/lang/chi_sim.traineddata.gz`；
  - 若两者都没有，OCR 会失败并**自动降级为手动录入**（不影响主流程）。
- 这些 OCR 资源不进 Service Worker 预缓存（按需加载），但会被打进 Android APK —— 若需减小安装包，可只保留 `tesseract-core-simd*`（现代 WebView 均支持 SIMD）。

---

## 已知限制

- 数据仅存本机，换设备需通过「导出/恢复」迁移。
- OCR 仅辅助录入，准确率受光线/角度影响，**请人工核对**；识别失败自动降级手动录入。
- 提醒：身份证明文存储（本机），展示已脱敏；若未来上云，建议启用 `src/utils/crypto.ts` 的 AES-GCM 加密后再上传。
- **OTA 只能更新网页层**：权限、插件等原生改动必须重新编译并安装 APK；OTA 更新包约 30MB（含离线 OCR 语言包），需联网。