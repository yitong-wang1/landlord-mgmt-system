/**
 * 测试入口：执行全部用例并输出报告。
 */
import { installLocalStorage, installCrypto, installDom } from './env';
import { runAll } from './harness';

installLocalStorage();
installCrypto();
installDom();

/* 触发用例注册（模块顶层即调用 test() 注册） */
import './dataLayer.test';
import './watermark.test';
import './consistency.test';

async function main(): Promise<void> {
  const results = await runAll();
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  let lastSuite = '';
  for (const r of results) {
    if (r.suite !== lastSuite) {
      lastSuite = r.suite;
      console.log(`\n  [${lastSuite}]`);
    }
    console.log(`   ${r.passed ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (!r.passed) {
      console.log(
        String(r.error)
          .split('\n')
          .map((l) => `          ${l}`)
          .join('\n'),
      );
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`总计 ${results.length} | 通过 ${passed} | 失败 ${failed}`);
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

void main();