#!/usr/bin/env node
/**
 * OTA 发布脚本 —— 构建网页包并发布到 GitHub Releases（免费托管）。
 *
 * 用法：
 *   node scripts/publish-ota.mjs              # 构建 + 打包 + 发布
 *   node scripts/publish-ota.mjs --no-build   # 跳过构建，直接打包当前 dist/
 *   node scripts/publish-ota.mjs --dry-run    # 只打包，不发布
 *
 * 前置（项目根 .env，该文件不要提交到 git）：
 *   VITE_OTA_REPO=你的用户名/你的仓库名     ← App 端读取，用于检查更新
 *   VITE_OTA_ASSET=dist.zip                ← 可选，附件名，默认 dist.zip
 *   GITHUB_TOKEN=ghp_xxxxxxxx              ← 本脚本发布用（需 Contents 写权限）
 *
 * 产物：dist.zip（网页包）+ dist.zip.sha256（校验和），作为 Release 附件上传。
 * App 端由 src/services/otaUpdater.ts 通过 GitHub Releases API 检查并下载。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// archiver v8 为 ESM 命名导出（不再是 callable 的默认导出）
import { ZipArchive } from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const ZIP = join(ROOT, 'dist.zip');
const SHA_FILE = join(ROOT, 'dist.zip.sha256');

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes('--no-build');
const DRY_RUN = args.includes('--dry-run');

/* ---------- 工具 ---------- */

/** 极简 .env 解析（不引第三方依赖；已存在的环境变量优先） */
function loadEnv() {
  const envPath = join(ROOT, '.env');
  const out = { ...process.env };
  if (!existsSync(envPath)) return out;
  for (const raw of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (out[key] === undefined) out[key] = val;
  }
  return out;
}

function run(cmd, cmdArgs, label) {
  console.log(`\n▸ ${label}：${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32', // Windows 上 npm 是 .cmd，需要 shell
  });
}

/** 把 dist/ 打包成 dist.zip（条目使用正斜杠，确保 Android 端可正常解压） */
function zipDist() {
  return new Promise((resolve, reject) => {
    if (existsSync(ZIP)) rmSync(ZIP);
    const output = createWriteStream(ZIP);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve({ bytes: archive.pointer() }));
    output.on('error', reject);
    archive.on('warning', (err) => (err.code === 'ENOENT' ? console.warn(err) : reject(err)));
    archive.on('error', reject);
    archive.pipe(output);
    // false = 不含 dist 这一层目录，内容直接位于 zip 根（更新插件要求 index.html 在根）
    archive.directory(DIST, false);
    void archive.finalize();
  });
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 调用 GitHub REST API */
async function gh(path, { method = 'GET', body, token, repo } = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'landlord-mgmt-ota-publisher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应，忽略 */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/* ---------- 主流程 ---------- */

async function main() {
  const env = loadEnv();
  const repo = (env.VITE_OTA_REPO || '').trim();
  const token = (env.GITHUB_TOKEN || '').trim();
  const assetName = (env.VITE_OTA_ASSET || 'dist.zip').trim();

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const version = pkg.version;
  const tag = `v${version}`;

  console.log('════════ OTA 发布 ════════');
  console.log(`仓库   : ${repo || '(未配置 VITE_OTA_REPO)'}`);
  console.log(`版本   : ${version}  →  tag ${tag}`);
  console.log(`附件名 : ${assetName}`);

  if (!SKIP_BUILD) {
    run('npm', ['run', 'build'], '构建网页包');
  } else {
    console.log('\n▸ 跳过构建（--no-build）');
  }

  if (!existsSync(DIST)) {
    console.error('\n✗ 未找到 dist/ 目录，请先执行 npm run build');
    process.exit(1);
  }

  console.log(`\n▸ 打包 dist/ → dist.zip`);
  const { bytes } = await zipDist();
  const sha = sha256File(ZIP);
  writeFileSync(SHA_FILE, `${sha}  ${assetName}\n`, 'utf-8');
  console.log(`  ✓ dist.zip  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ✓ sha256    ${sha}`);

  if (DRY_RUN) {
    console.log('\n▸ --dry-run：跳过上传。产物已生成于项目根目录。');
    return;
  }
  if (!repo) {
    console.error('\n✗ 未配置 VITE_OTA_REPO。请在项目根 .env 写入：VITE_OTA_REPO=用户名/仓库名');
    process.exit(1);
  }
  if (!token) {
    console.error('\n✗ 未配置 GITHUB_TOKEN。请在项目根 .env 写入带 Contents 写权限的 token。');
    process.exit(1);
  }

  console.log('\n▸ 查找或创建 Release…');
  const found = await gh(`/releases/tags/${tag}`, { token, repo });
  let release = found.json;

  if (!release || !release.id) {
    const created = await gh('/releases', {
      method: 'POST',
      token,
      repo,
      body: {
        tag_name: tag,
        name: `房东管理系统 ${tag}`,
        body:
          `自动发布的 OTA 更新包（仅网页层）。\n\n` +
          `- 版本：${version}\n- sha256：\`${sha}\`\n- 附件：\`${assetName}\`\n\n` +
          `> 仅更新网页层（界面/逻辑）。原生层改动（权限、插件）仍需重新编译 APK。`,
        draft: false,
        prerelease: false,
      },
    });
    if (!created.ok) {
      console.error(`\n✗ 创建 Release 失败（HTTP ${created.status}）：${(created.text || '').slice(0, 300)}`);
      process.exit(1);
    }
    release = created.json;
    console.log(`  ✓ 已创建 Release ${tag} (id=${release.id})`);
  } else {
    console.log(`  ✓ Release ${tag} 已存在 (id=${release.id})，将覆盖同名附件`);
  }

  // GitHub 不允许同名附件，先删除旧的
  for (const a of release.assets ?? []) {
    if (a.name === assetName || a.name === `${assetName}.sha256`) {
      await gh(`/releases/assets/${a.id}`, { method: 'DELETE', token, repo });
      console.log(`  - 已删除旧附件 ${a.name}`);
    }
  }

  const uploadBase = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets`;
  const files = [
    { name: assetName, path: ZIP, type: 'application/zip' },
    { name: `${assetName}.sha256`, path: SHA_FILE, type: 'text/plain' },
  ];
  for (const f of files) {
    const res = await fetch(`${uploadBase}?name=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'landlord-mgmt-ota-publisher',
        'Content-Type': f.type,
      },
      body: readFileSync(f.path),
    });
    if (!res.ok) {
      console.error(`\n✗ 上传 ${f.name} 失败（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
    console.log(`  ✓ 已上传 ${f.name}  (${(statSync(f.path).size / 1024).toFixed(1)} KB)`);
  }

  console.log('\n════════ 发布完成 ════════');
  console.log(`Release : https://github.com/${repo}/releases/tag/${tag}`);
  console.log(`下载地址: https://github.com/${repo}/releases/download/${tag}/${assetName}`);
  console.log('\n手机 App 下次启动时会自动检查并更新（需联网）。');
}

main().catch((err) => {
  console.error('\n✗ 发布失败：', err);
  process.exit(1);
});
