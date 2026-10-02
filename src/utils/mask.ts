/**
 * 脱敏工具。身份证号展示必须走这里或 MaskedField 组件。
 * 规则（产品决策）：前 3 位 + ***********(11 个*) + 后 4 位。
 *   e.g. 110101199003071234 -> 110***********1234
 */

const MASK_STARS = '*'.repeat(11);

/**
 * 身份证号脱敏。
 * @param idCard 明文身份证号
 * @returns 脱敏字符串；长度不足时尽量保留首尾
 */
export function maskIdCard(idCard: string): string {
  if (!idCard) return '';
  const s = idCard.trim();
  if (s.length <= 7) {
    // 太短，仅保留首位与末位
    if (s.length <= 2) return s;
    return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
  }
  const head = s.slice(0, 3);
  const tail = s.slice(-4);
  return `${head}${MASK_STARS}${tail}`;
}

/**
 * 手机号脱敏：中间 4 位打码。
 *   e.g. 13800138000 -> 138****8000
 */
export function maskPhone(phone: string): string {
  if (!phone) return '';
  const s = phone.trim();
  if (s.length < 7) return s;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/**
 * 通用脱敏：保留头尾各 n 位，中间用 * 填充。
 */
export function maskGeneric(value: string, head = 3, tail = 4): string {
  if (!value) return '';
  const s = value.trim();
  if (s.length <= head + tail) {
    return s[0] + '*'.repeat(Math.max(0, s.length - 1)) + (s.length > 1 ? s[s.length - 1] : '');
  }
  return `${s.slice(0, head)}${'*'.repeat(s.length - head - tail)}${s.slice(-tail)}`;
}
