/**
 * 月份 / 周期处理工具（基于 date-fns）。
 * 约定：所有月份统一用 "YYYY-MM" 字符串表达。
 */
import {
  addMonths,
  differenceInCalendarMonths,
  format,
  parse,
} from 'date-fns';

/** 月份格式 */
export const MONTH_FORMAT = 'yyyy-MM';

/** 当前月份 "YYYY-MM" */
export function currentMonth(): string {
  return format(new Date(), MONTH_FORMAT);
}

/** 当前 ISO 时间戳 */
export function nowISO(): string {
  return new Date().toISOString();
}

/** 将 "YYYY-MM" 解析为 Date（该月 1 号） */
export function parseMonth(month: string): Date {
  const d = parse(month, MONTH_FORMAT, new Date());
  if (Number.isNaN(d.getTime())) {
    throw new Error(`非法月份格式: ${month}，应为 YYYY-MM`);
  }
  return d;
}

/** 将 Date 格式化为 "YYYY-MM" */
export function toMonth(d: Date): string {
  return format(d, MONTH_FORMAT);
}

/** 月份加 n 个月，返回 "YYYY-MM" */
export function monthAdd(month: string, n: number): string {
  return toMonth(addMonths(parseMonth(month), n));
}

/** 上一月 */
export function prevMonth(month: string): string {
  return monthAdd(month, -1);
}

/** 下一月 */
export function nextMonth(month: string): string {
  return monthAdd(month, 1);
}

/**
 * 两个月份之间的间隔月数（不含端点）。例如 monthDiff('2026-01','2026-04') = 3。
 */
export function monthDiff(start: string, end: string): number {
  return differenceInCalendarMonths(parseMonth(end), parseMonth(start));
}

/**
 * 两个月份之间（含端点）的月份列表。
 * 例如 listMonths('2026-01','2026-03') = ['2026-01','2026-02','2026-03']。
 */
export function listMonths(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  // 防御：最多 600 个月，避免异常输入导致死循环
  for (let i = 0; i <= 600; i++) {
    result.push(cursor);
    if (cursor === end) break;
    cursor = monthAdd(cursor, 1);
  }
  return result;
}

/** month 是否落在 [start, end] 闭区间内（含端点） */
export function monthInRange(month: string, start: string, end: string): boolean {
  return monthDiff(start, month) >= 0 && monthDiff(month, end) >= 0;
}

/** 该月所在的供暖季年份（供暖通常 11 月~次年 4 月；用起算年作为供暖年） */
export function heatingYearOf(month: string): number {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // 11、12 月归属当年供暖年；1~4 月归属上一年供暖年
  return m >= 11 ? year : year - 1;
}

/** 判断某月是否属于供暖月（11~4 月） */
export function isHeatingMonth(month: string): boolean {
  const m = Number(month.slice(5, 7));
  return m === 11 || m === 12 || m === 1 || m === 2 || m === 3 || m === 4;
}

/** 供暖月列表（某供暖年的 6 个供暖月，按时间顺序） */
export function heatingMonthsOf(year: number): string[] {
  return [
    `${year}-11`,
    `${year}-12`,
    `${year + 1}-01`,
    `${year + 1}-02`,
    `${year + 1}-03`,
    `${year + 1}-04`,
  ];
}

/** 友好展示：2026-03 -> 2026年3月 */
export function formatMonthCN(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${year}年${m}月`;
}

/** 友好展示时间戳 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
