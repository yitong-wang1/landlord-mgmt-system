/**
 * QA 测试入口：esbuild 打包 -> node 执行。
 * 用法: node qa/run.cjs
 */
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/esbuild/bin/esbuild'), 'qa/index.ts', '--bundle',
   '--platform=node', '--format=cjs', '--target=node20', '--outfile=qa/.bundle.cjs',
   '--log-level=warning'],
  { cwd: root, stdio: 'inherit' },
);
require('./.bundle.cjs');
