/**
 * 金额工具：一律以「分」(整数) 存储，此处负责与「元」的互转与展示。
 */

/** 元 -> 分（四舍五入） */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

/** 分 -> 元（数值，保留两位） */
export function centsToYuan(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * 格式化「分」为整数货币字符串。
 * @param cents 金额（分）
 * @param symbol 货币符号，默认 ¥
 * @param withSign 是否带正负号（用于欠费展示），默认 false
 */
export function formatCents(
  cents: number,
  symbol = '¥',
  withSign = false,
): string {
  const value = Math.round(cents) / 100;
  const fixed = value.toFixed(2);
  if (withSign && cents > 0) {
    return `+${symbol}${fixed}`;
  }
  return `${symbol}${fixed}`;
}

/** 带「欠」语义的展示：正数返回 "¥x.xx"，负数返回 "欠 ¥x.xx" */
export function formatOutstanding(cents: number, symbol = '¥'): string {
  if (cents <= 0) return `${symbol}0.00`;
  return `欠 ${symbol}${(cents / 100).toFixed(2)}`;
}

/** 安全解析用户输入的金额文本（元），非法返回 0 */
export function parseYuanInput(text: string): number {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}
