/**
 * 极简断言 + 用例注册器（避免引入 vitest/jest 依赖，环境无测试框架）。
 */
export interface CaseResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: CaseResult[] = [];
let currentSuite = 'default';

/** 开始一个用例组 */
export function describe(name: string, fn: () => void): void {
  currentSuite = name;
  fn();
}

export class AssertionError extends Error {}

function fail(msg: string): never {
  throw new AssertionError(msg);
}

export function ok(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

export function eq<T>(actual: T, expected: T, msg: string): void {
  if (!Object.is(actual, expected)) {
    fail(`${msg}\n    预期: ${String(expected)}\n    实际: ${String(actual)}`);
  }
}

export function deepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${msg}\n    预期: ${b}\n    实际: ${a}`);
}

export function includes(hay: string, needle: string, msg: string): void {
  if (!hay.includes(needle)) {
    fail(`${msg}\n    期望包含: ${needle}\n    实际: ${hay}`);
  }
}

/** 注册并立即执行一个用例，失败不中断（收集全部结果） */
export function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const run = async () => {
    try {
      await fn();
      results.push({ suite: currentSuite, name, passed: true });
    } catch (e) {
      results.push({
        suite: currentSuite,
        name,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  pending.push(run);
  return Promise.resolve();
}

const pending: Array<() => Promise<void>> = [];

/** 依次执行所有已注册用例，返回统计 */
export async function runAll(): Promise<CaseResult[]> {
  for (const r of pending) await r();
  return results;
}

export function getResults(): CaseResult[] {
  return results;
}

export function clearResults(): void {
  results.length = 0;
}