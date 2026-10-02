/**
 * 全局核心类型定义。
 *
 * 约定（见系统设计文档第 7 节）：
 * - 金额一律以「分」(number 整数) 存储，展示经 utils/money.ts。
 * - 月份统一用 "YYYY-MM" 字符串。
 * - 时间戳统一 ISO 8601 UTC 字符串（new Date().toISOString()）。
 * - ID 一律 crypto.randomUUID()。
 *
 * 与系统设计的偏差（以产品决策为准）：
 * 1. 身份证号按产品决策「明文存储、不实现 AES 加密」，故 Tenant 用 idCard(明文) + idCardMasked(脱敏展示)。
 *    仍保留 utils/crypto.ts（AES-GCM 工具）供未来云端加密使用，但 MVP 不接入。
 * 2. FeeType 扩充 scope / billingMode / fixedAmount / appliesTo（产品决策 #6：自定义费用含 scope + 固定月金额）。
 * 3. Payment 扩充 prepaid / periodStart / periodEnd（产品决策 #4：季付/年付预收整周期抵扣）。
 * 4. 新增 Settings 实体（产品决策 #7：电费单价等可配置项）。
 */

/** 缴费周期：月付 / 季付 / 年付 */
export type PaymentCycle = 'monthly' | 'quarterly' | 'yearly';

/** 房间状态：空置 / 出租 */
export type RoomStatus = 'vacant' | 'rented';

/** 费用大类：租金 / 电费 / 供暖费 / 自定义 */
export type FeeCategory = 'rent' | 'electricity' | 'heating' | 'custom';

/** 自定义费用作用范围：按租户 / 按房间 / 全局 */
export type FeeScope = 'tenant' | 'room' | 'global';

/** 计费模式：固定月金额 / 按用量 / 周期(供暖等) */
export type BillingMode = 'fixed' | 'usage' | 'cycle';

/** 供暖费状态：已缴 / 未缴 / 部分 */
export type HeatingStatus = 'paid' | 'unpaid' | 'partial';

/** 账单状态：已清 / 欠费 / 部分 */
export type BillStatus = 'settled' | 'owed' | 'partial';

/** 押金类型：可退 / 抵扣 */
export type DepositType = 'refundable' | 'offset';

/** 缴费记录分类：租金 / 押金 / 其他 */
export type PaymentCategory = 'rent' | 'deposit' | 'other';

/** 月份字符串，格式 "YYYY-MM" */
export type MonthStr = string;

/** 带水印取证照片处理结果（电表照片 / 证件照统一使用） */
export interface EvidenceResult {
  /** 叠加水印后的图片 Blob（原图不留存） */
  blob: Blob;
  /** 带水印图片的 SHA-256 哈希（hex，防篡改校验用） */
  hash: string;
  /** 拍摄时间戳（ISO，取自本机时钟） */
  capturedAt: string;
  /** 拍摄纬度（获取失败为 null） */
  lat: number | null;
  /** 拍摄经度（获取失败为 null） */
  lng: number | null;
}

/** 租户 */
export interface Tenant {
  id: string;
  /** 姓名 */
  name: string;
  /** 身份证号明文（产品决策：不加密、明文存储） */
  idCard: string;
  /** 脱敏展示用，如 110***********1234 */
  idCardMasked: string;
  phone: string;
  paymentCycle: PaymentCycle;
  /** 收几个月押金 */
  depositMonths: number;
  /**
   * 押金金额（分）。
   * 由「押金月数 × 房间月租金」自动算出，也支持在租户表单里手工指定实际金额。
   * 未设置时视为「未单独指定」，展示与计算回退到 depositMonths。
   */
  depositAmount?: number;
  depositType: DepositType;
  /** 退租时是否可扣款 */
  depositDeductibleOnExit: boolean;
  /** 证件照在 photoDB 的 id（用户勾选「保存证件照」时才有） */
  idCardPhotoId?: string;
  /** 证件照（带水印后）的 SHA-256 哈希（hex，防篡改校验） */
  idCardPhotoHash?: string;
  /** 证件照拍摄时间戳（ISO，取自本机时钟） */
  idCardCapturedAt?: string;
  /** 证件照拍摄纬度（获取失败为 null） */
  idCardLat?: number | null;
  /** 证件照拍摄经度（获取失败为 null） */
  idCardLng?: number | null;
  /** 占用房间 id（MVP 1:1，预留 1:N） */
  roomId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 房间 */
export interface Room {
  id: string;
  /** 房间名/编号 */
  name: string;
  /** 月租金（分） */
  monthlyRent: number;
  status: RoomStatus;
  tenantId?: string;
  /** 房间照片在 photoDB 的 id 列表 */
  photoIds: string[];
  createdAt: string;
}

/** 费用类型（内置 + 自定义） */
export interface FeeType {
  id: string;
  name: string;
  category: FeeCategory;
  isBuiltin: boolean;
  /** 自定义费用作用范围（内置类型可省略） */
  scope?: FeeScope;
  /** 计费模式（内置：rent=cycle, electricity=usage, heating=cycle；自定义=custom=fixed） */
  billingMode?: BillingMode;
  /** 单位（如电费「度」） */
  unit?: string;
  /** 单价（分/单位，电费等按用量计费时使用） */
  unitPrice?: number;
  /** 固定月金额（分，自定义固定费用 / 供暖等） */
  fixedAmount?: number;
  /**
   * 适用目标 id 列表（tenantId 或 roomId）。
   * 为空表示「该 scope 下全部目标」（用于「应用到全部租户/房间」）。
   */
  appliesTo?: string[];
  createdAt: string;
}

/** 抄表记录（按月） */
export interface MeterRecord {
  id: string;
  roomId: string;
  month: MonthStr;
  /** 上期读数 */
  prevReading?: number;
  /** 本期读数 */
  currReading?: number;
  /** 用量（度）。可直填，也可由读数差计算 */
  usage: number;
  recordedAt: string;
  /** 电表照片（带水印后）在 photoDB 的 id */
  photoId?: string;
  /** 带水印图片的 SHA-256 哈希（hex，防篡改校验） */
  photoHash?: string;
  /** 拍摄时间戳（ISO，取自本机时钟） */
  capturedAt?: string;
  /** 拍摄纬度（获取失败为 null） */
  lat?: number | null;
  /** 拍摄经度（获取失败为 null） */
  lng?: number | null;
}

/** 供暖费（按房间 / 年） */
export interface HeatingFee {
  id: string;
  roomId: string;
  tenantId: string;
  year: number;
  status: HeatingStatus;
  /** 总额（分） */
  amount: number;
  /** 已缴金额（分） */
  paidAmount: number;
  paidDate?: string;
}

/** 缴费记录（含押金） */
export interface Payment {
  id: string;
  tenantId: string;
  roomId: string;
  /** 该笔缴费所属账单月份 "YYYY-MM"（单月租金/其他） */
  billMonth: MonthStr;
  /** 金额（分） */
  amount: number;
  category?: PaymentCategory;
  paidAt: string;
  method?: string;
  note?: string;
  /** 是否预收整周期（季付/年付租金）。为 true 时通过 periodStart/periodEnd 覆盖多个月 */
  prepaid?: boolean;
  /** 预收起始月 "YYYY-MM" */
  periodStart?: MonthStr;
  /** 预收结束月 "YYYY-MM" */
  periodEnd?: MonthStr;
}

/** 账单明细项 */
export interface BillItem {
  feeTypeId: string;
  feeName: string;
  /** 金额（分） */
  amount: number;
  /** 覆盖周期说明（如 "2026-03 ~ 2026-05 预收"） */
  periodCovered?: string;
  note?: string;
}

/** 月度账单（由实体派生，非手工录入） */
export interface Bill {
  id: string;
  tenantId: string;
  roomId: string;
  month: MonthStr;
  items: BillItem[];
  /** 应收合计（分） */
  totalReceivable: number;
  /** 已缴合计（分，含单月租金/其他缴费；预收抵扣不计入月度已缴） */
  totalPaid: number;
  /** 欠费（分）= totalReceivable - totalPaid */
  outstanding: number;
  status: BillStatus;
  generatedAt: string;
}

/** 照片（存于 IndexedDB，不进 localStorage） */
export interface Photo {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: string;
}

/** 应用设置（单例） */
export interface Settings {
  id: string; // 固定为 'app'
  /** 电费单价（分/度） */
  electricityUnitPrice: number;
  /** 房东署名（导出/催缴落款用） */
  landlordName: string;
  /** 备份文件版本号 */
  schemaVersion: number;
}

/** 备份中的单张照片 */
export interface BackupPhoto {
  /** base64（去 dataURL 头） */
  data: string;
  /** MIME 类型 */
  mime: string;
}

/** 备份文件结构（含照片 base64） */
export interface BackupFile {
  version: number;
  exportedAt: string;
  /** 各实体集合 */
  data: BackupData;
  /** 照片：id -> { base64, mime } */
  photos: Record<string, BackupPhoto>;
}

/** 轻量备份（不含照片） */
export interface LightBackupFile {
  version: number;
  exportedAt: string;
  data: BackupData;
}

/** 备份中的结构化数据集合 */
export interface BackupData {
  tenants: Tenant[];
  rooms: Room[];
  feeTypes: FeeType[];
  meterRecords: MeterRecord[];
  heatingFees: HeatingFee[];
  payments: Payment[];
  bills: Bill[];
  settings: Settings;
}

/** 备份类型枚举 */
export type BackupKind = 'full' | 'light';

/** 实体仓储主键集合（用于 repository 泛型分发） */
export type EntityKey =
  | 'tenants'
  | 'rooms'
  | 'feeTypes'
  | 'meterRecords'
  | 'heatingFees'
  | 'payments'
  | 'bills';

/** 实体类型映射 */
export interface EntityMap {
  tenants: Tenant;
  rooms: Room;
  feeTypes: FeeType;
  meterRecords: MeterRecord;
  heatingFees: HeatingFee;
  payments: Payment;
  bills: Bill;
}

/** 账单生成上下文（供 billingEngine 使用） */
export interface BillingContext {
  tenant: Tenant;
  room: Room;
  month: MonthStr;
  feeTypes: FeeType[];
  meterRecords: MeterRecord[];
  heatingFees: HeatingFee[];
  payments: Payment[];
  settings: Settings;
}

/** 通用异步结果 */
export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
