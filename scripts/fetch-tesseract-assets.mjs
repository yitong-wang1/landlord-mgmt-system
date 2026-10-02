// 组装 Tesseract.js 离线资源到 public/tesseract（供 Android WebView 离线加载）。
// 1) 复制 worker + wasm 核心（来自 node_modules，必成功）。
// 2) 尝试下载中文语言包 chi_sim.traineddata.gz；若网络受限失败则给出提示（OCR 会回退 CDN 或降级手动录入）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'tesseract');
const langDir = path.join(outDir, 'lang');
fs.mkdirSync(langDir, { recursive: true });

function copyIfExists(src, destName) {
  if (!fs.existsSync(src)) {
    console.warn('缺少源文件，跳过:', src);
    return false;
  }
  fs.copyFileSync(src, path.join(outDir, destName));
  console.log('复制:', destName);
  return true;
}

// 1) worker
copyIfExists(
  path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  'worker.min.js',
);

// 2) wasm 核心（tesseract.js 会按 SIMD/浏览器能力自动挑选 tesseract-core*.wasm(.js)）
const coreDir = path.join(root, 'node_modules', 'tesseract.js-core');
for (const f of fs.readdirSync(coreDir)) {
  if (/^tesseract-core.*\.(wasm|js)$/.test(f)) {
    copyIfExists(path.join(coreDir, f), f);
  }
}

// 3) 中文语言包（可选，尝试下载）
const LANG_URLS = [
  'https://tessdata.projectnaptha.com/4.0.0/chi_sim.traineddata.gz',
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/chi_sim.traineddata.gz',
];
const langFile = path.join(langDir, 'chi_sim.traineddata.gz');

async function fetchLang() {
  if (fs.existsSync(langFile) && fs.statSync(langFile).size > 1000) {
    console.log('中文语言包已存在，跳过下载');
    return true;
  }
  for (const url of LANG_URLS) {
    try {
      console.log('尝试下载中文语言包:', url);
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(langFile, buf);
      console.log('中文语言包下载成功:', (buf.length / 1024 / 1024).toFixed(1), 'MB');
      return true;
    } catch (err) {
      console.warn('下载失败:', err.message);
    }
  }
  console.warn(
    '\n⚠️ 未能下载 chi_sim.traineddata.gz（可能网络受限）。\n' +
      '  · 在线环境下 OCR 会自动回退 CDN，功能可用。\n' +
      '  · 离线/内网使用请手动放置语言包到：public/tesseract/lang/chi_sim.traineddata.gz\n' +
      '  · 未放置时 OCR 会失败并自动降级为手动录入（不影响主流程）。',
  );
  return false;
}

await fetchLang();
console.log('完成。资源目录:', outDir);