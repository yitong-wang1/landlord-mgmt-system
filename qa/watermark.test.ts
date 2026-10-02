/**
 * 水印 + 防篡改 + OCR 资源路径测试。
 */
import {
  addWatermark,
  composeWatermarkLines,
  createEvidencePhoto,
  formatGeo,
  getGeolocation,
  sha256Hex,
  verifyHash,
} from '../src/utils/watermark';
import { parseIdCard, parseName, enhanceForOcr } from '../src/ocr/idCardOCR';
import { mapCoverCrop } from '../src/hooks/useCamera';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, eq, ok, includes } from './harness';
import {
  canvasLog,
  installCrypto,
  installDom,
  installGeolocation,
  originalBlobRegistry,
  resetCanvasLog,
  watermarkBlobRegistry,
} from './env';

const ROOT = resolve(__dirname, '..');

installCrypto();
installDom();

function makeBlob(content = 'original-image-bytes'): Blob {
  const b = new Blob([content], { type: 'image/jpeg' });
  originalBlobRegistry.add(b);
  return b;
}

/* ================= 水印内容 ================= */

describe('水印内容与兜底', () => {
  test('水印包含时间 + 经纬度两行', () => {
    const lines = composeWatermarkLines('2026-03-05T08:30:00.000Z', 39.9042, 116.4074);
    eq(lines.length, 2, '应为 2 行');
    ok(lines[0].includes('拍摄时间'), `第 1 行应含「拍摄时间」，实际 ${lines[0]}`);
    includes(lines[1], '位置', '第 2 行应含「位置」');
    includes(lines[1], '39.9042', '应含纬度');
    includes(lines[1], '116.4074', '应含经度');
  });

  test('GPS 失败时兜底为「定位不可用」（不抛异常、不阻塞）', () => {
    const lines = composeWatermarkLines('2026-03-05T08:30:00.000Z', null, null);
    includes(lines[1], '定位不可用', 'GPS 缺失时应标注定位不可用');
    eq(formatGeo(null, null), '定位不可用', 'formatGeo 应返回定位不可用');
    eq(formatGeo(undefined, 1), '定位不可用', '仅一个坐标为 null 也应返回定位不可用');
  });

  test('getGeolocation：GPS 拒绝时返回 null 而非 reject', async () => {
    installGeolocation(null);
    const r = await getGeolocation(500);
    eq(r, null, 'GPS 失败应返回 null');
  });

  test('getGeolocation：GPS 成功时返回坐标', async () => {
    installGeolocation({ lat: 31.2304, lng: 121.4737 });
    const r = await getGeolocation(500);
    ok(r !== null, 'GPS 成功应返回坐标');
    eq(r?.lat, 31.2304, '纬度正确');
    eq(r?.lng, 121.4737, '经度正确');
    installGeolocation(null);
  });
});

/* ================= canvas 水印叠加 ================= */

describe('canvas 水印叠加', () => {
  test('addWatermark 实际执行了绘制：drawImage + 底部色条 + fillText', async () => {
    resetCanvasLog();
    const out = await addWatermark(makeBlob(), '2026-03-05T08:30:00.000Z', 39.9042, 116.4074);

    eq(canvasLog.drawImage, 1, '应绘制一次原图');
    eq(canvasLog.fillRect.length, 1, '应绘制一次底部半透明色条');
    eq(canvasLog.fillText.length, 2, '应写入 2 行水印文字（时间 + 位置）');
    ok(canvasLog.fillRect[0].h > 0 && canvasLog.fillRect[0].w > 0, '色条应有实际尺寸');
    // 色条应在图片底部
    const rect = canvasLog.fillRect[0];
    ok(rect.y > 0, `色条应在底部区域，实际 y=${rect.y}`);
    ok(canvasLog.toBlobCalls, '应导出为新 Blob');
    ok(out.size > 0, '输出 Blob 非空');
  });

  test('大图被限制到 1280 宽（避免原图体积进本地库）', async () => {
    resetCanvasLog();
    await addWatermark(makeBlob(), '2026-03-05T08:30:00.000Z', null, null);
    // FakeImage 原始 4000x3000 -> 应缩放
    ok(canvasLog.fillRect[0].w <= 1280, `宽度应被压到 <=1280，实际 ${canvasLog.fillRect[0].w}`);
  });
});

/* ================= SHA-256 与顺序（关键） ================= */

describe('防篡改哈希', () => {
  test('sha256Hex 输出 64 位 hex', async () => {
    const h = await sha256Hex(makeBlob());
    eq(h.length, 64, 'SHA-256 hex 应为 64 字符');
    ok(/^[0-9a-f]{64}$/.test(h), `应为小写 hex，实际 ${h}`);
  });

  test('【关键】哈希必须对「带水印后」图片计算，而非原图', async () => {
    installGeolocation(null);
    resetCanvasLog();
    const original = makeBlob('ORIGINAL-IMAGE-CONTENT');
    const res = await createEvidencePhoto(original);

    // res.blob 必须是水印后的新对象，不能是原图
    eq(watermarkBlobRegistry.has(res.blob), true, '返回的 blob 应为水印后新 Blob');
    eq(originalBlobRegistry.has(res.blob), false, '返回的 blob 不得是原图对象');
    ok(res.blob !== original, 'blob 引用应与原图不同');

    // 重新对 res.blob 计算哈希，必须与记录一致（否则详情页校验永远失败）
    const recomputed = await sha256Hex(res.blob);
    eq(res.hash, recomputed, '记录的 hash 必须等于对最终带水印图重算的哈希');

    // 且不应等于原图哈希
    const origHash = await sha256Hex(original);
    ok(res.hash !== origHash, 'hash 不应等于原图哈希（说明顺序未反）');
    includes(origHash, origHash.slice(0, 4), '对照：原图哈希可计算');
  });

  test('verifyHash 对同一张图返回 true', async () => {
    const blob = makeBlob('verify-me');
    const h = await sha256Hex(blob);
    eq(await verifyHash(blob, h), true, '同图校验应通过');
  });

  test('verifyHash 对被篡改/替换的图返回 false（防篡改有效）', async () => {
    const blob = makeBlob('original-a');
    const h = await sha256Hex(blob);
    const tampered = makeBlob('original-b-tampered');
    eq(await verifyHash(tampered, h), false, '不同内容的图校验应失败');
  });

  test('verifyHash 空预期哈希返回 false（不做无校验放行）', async () => {
    eq(await verifyHash(makeBlob(), ''), false, '空预期哈希应返回 false');
  });

  test('createEvidencePhoto 返回 GPS 失败时 lat/lng 为 null 且元数据齐全', async () => {
    installGeolocation(null);
    const res = await createEvidencePhoto(makeBlob(), '2026-03-05T08:30:00.000Z');
    eq(res.lat, null, 'GPS 失败 lat 应为 null');
    eq(res.lng, null, 'GPS 失败 lng 应为 null');
    eq(res.capturedAt, '2026-03-05T08:30:00.000Z', '应保留传入拍摄时间');
    ok(res.hash.length === 64, '应返回完整哈希');
    ok(res.blob instanceof Blob, '应返回 Blob');
  });
});

/* ================= OCR 资源路径与文件存在性 ================= */

describe('OCR 离线资源与路径', () => {
  test('idCardOCR 使用绝对路径配置（非相对路径）', () => {
    const src = readFileSync(resolve(ROOT, 'src/ocr/idCardOCR.ts'), 'utf8');
    ok(!src.includes("'tesseract/worker.min.js'"), 'workerPath 不应为相对路径');
    ok(!src.includes("'tesseract/lang'"), 'langPath 不应为相对路径');
    ok(!src.includes("'tesseract/'"), 'corePath 不应为相对路径');
    includes(src, "'/tesseract/worker.min.js'", 'workerPath 应为绝对路径 /tesseract/...');
    includes(src, "'/tesseract/lang'", 'langPath 应为绝对路径');
    includes(src, "'/tesseract/'", 'corePath 应为绝对路径');
  });

  test('public/tesseract/ 下 worker / wasm / 语言包真实存在且非空', () => {
    const base = resolve(ROOT, 'public/tesseract');
    const required: Array<[string, number]> = [
      ['worker.min.js', 50_000],
      ['tesseract-core-lstm.wasm', 1_000_000],
      ['tesseract-core-simd-lstm.wasm', 1_000_000],
      ['tesseract-core.wasm', 1_000_000],
      ['tesseract-core-simd.wasm', 1_000_000],
      ['lang/chi_sim.traineddata.gz', 5_000_000],
    ];
    for (const [rel, minSize] of required) {
      const p = resolve(base, rel);
      ok(existsSync(p), `缺失必需文件: public/tesseract/${rel}`);
      const size = statSync(p).size;
      ok(size >= minSize, `public/tesseract/${rel} 体积异常小: ${size} < ${minSize}（可能是占位文件）`);
    }
  });

  test('dist 构建产物中确实含 tesseract 资源（webDir 同步用）', () => {
    const distBase = resolve(ROOT, 'dist/tesseract');
    ok(existsSync(distBase), 'dist/tesseract 不存在');
    ok(existsSync(resolve(distBase, 'worker.min.js')), 'dist/tesseract/worker.min.js 缺失');
    ok(existsSync(resolve(distBase, 'lang/chi_sim.traineddata.gz')), 'dist 语言包缺失');
  });

  test('Android assets 已包含构建产物与 tesseract 资源', () => {
    const assets = resolve(ROOT, 'android/app/src/main/assets/public');
    ok(existsSync(resolve(assets, 'index.html')), 'Android assets 缺 index.html');
    ok(existsSync(resolve(assets, 'assets')), 'Android assets 缺 assets 目录');
    ok(existsSync(resolve(assets, 'tesseract/worker.min.js')), 'Android assets 缺 OCR worker');
  });

  test('身份证解析：姓名 + 18 位号码', () => {
    const text = '姓名 张三\n公民身份号码 110101199001011234';
    eq(parseName(text), '张三', '应解析出姓名');
    eq(parseIdCard(text), '110101199001011234', '应解析出身份证号');
    eq(parseName('无效文本'), undefined, '无姓名时返回 undefined');
    eq(parseIdCard('无号码'), undefined, '无号码时返回 undefined');
  });

  test('小写 x 的身份证号应被规范为大写 X', () => {
    eq(parseIdCard('11010119900101123x'), '11010119900101123X', '末位 x 应转 X');
  });

  test('姓名解析：容忍真实身份证排版与 OCR 噪声', () => {
    // 姓名与后续字段粘连（最常见）
    eq(parseName('姓名张三性别男'), '张三', '姓名应与后续字段切分');
    eq(parseName('姓名张三民族汉'), '张三', '姓名应止于「民族」');
    // 同一行用空白分隔
    eq(parseName('姓名 张 三'), '张三', '姓名字间空白应合并');
    eq(parseName('姓名：李四'), '李四', '中文冒号应支持');
    eq(parseName('姓名: 王五'), '王五', '半角冒号+空格应支持');
    // 全角空格
    eq(parseName('姓名\u3000赵六'), '赵六', '全角空格应支持');
    // 复姓（4 字名）
    eq(parseName('姓名 欧阳娜娜'), '欧阳娜娜', '复姓四字名应完整保留');
    // 多行真实排版
    eq(
      parseName('姓名 张三\n性别 男 民族 汉\n出生 1990年1月1日\n住址 某某省某某市'),
      '张三',
      '多行排版应只取姓名',
    );
    // 拆成「姓」「名」两段
    eq(parseName('姓 张\n名 三'), '张三', '拆分排版应能拼合');
    // 只识别出字段名、没有姓名 → 不得把字段名当姓名
    eq(parseName('姓名性别民族'), undefined, '整串是字段名时应返回 undefined');
    eq(parseName('姓名 出生'), undefined, '字段名后无有效姓名应返回 undefined');
    // 无效输入
    eq(parseName(''), undefined, '空串返回 undefined');
    eq(parseName('110101199001011234'), undefined, '纯数字无误判');
  });

  test('姓名解析：兜底规则——「姓名」标签被认花时按字段位置识别', () => {
    // 标签被 OCR 认错（如「蛙名」），但姓名紧邻「性别」行 —— 身份证版式里这个位置关系更稳
    eq(parseName('蛙名 张三 性别 男'), '张三', '标签认花时应靠紧邻「性别」兜底');
    eq(parseName('姓名 李四 民族 汉'), '李四', '靠紧邻「民族」兜底');
    eq(parseName('王五 出生 1990年1月1日'), '王五', '靠紧邻「出生」兜底');
    eq(parseName('赵六住址 某某省'), '赵六', '无空格粘连也应能切出姓名');

    // 不得把字段名本身当成姓名
    eq(parseName('性别 男 民族 汉'), undefined, '纯字段行不得误判为姓名');
    eq(parseName('民族 汉 出生 1990'), undefined, '民族行不得误判为姓名');
    eq(
      parseName('住址 某某省某某市某某路1号'),
      undefined,
      '住址内容不得误判为姓名',
    );

    // 完整卡片文本（OCR 常见形态）
    const card = [
      '蛙名 张三',
      '性别 男 民族 汉',
      '出生 1990 年 1 月 1 日',
      '住址 某某省某某市某某区某某路 1 号',
      '公民身份号码 110101199001011234',
    ].join('\n');
    eq(parseName(card), '张三', '完整卡片文本应能取出姓名');
    eq(parseIdCard(card), '110101199001011234', '完整卡片文本应能取出号码');
  });

  test('身份证号解析：容忍 OCR 在号码中夹入空白/噪声', () => {
    eq(
      parseIdCard('公民身份号码 110101 19900101 1234'),
      '110101199001011234',
      '号码被空格分组应能拼回',
    );
    eq(
      parseIdCard('公民身价号码 110101199001011234'),
      '110101199001011234',
      '前置字段名被误识别不影响取号',
    );
    eq(parseIdCard('1101011990-0101-1234'), '110101199001011234', '夹入连字符应能容错');
    eq(parseIdCard('号码 11010119900101123x'), '11010119900101123X', '容错分支同样规范 X');
    eq(parseIdCard('12345'), undefined, '位数不足不得误判');
  });

  test('enhanceForOcr 在无 DOM 环境下安全降级（不得抛错、不得阻断识别）', async () => {
    // 测试环境没有 document，预处理应当原样返回输入而不是崩溃
    const blob = new Blob(['not-a-real-image'], { type: 'image/jpeg' });
    const out = await enhanceForOcr(blob);
    eq(out, blob, '无 DOM 时应原样返回输入对象');
    ok(out instanceof Blob, '返回值应为 Blob');
  });
});

/* ================= 取景框裁剪映射 ================= */

describe('取景框裁剪映射（mapCoverCrop）', () => {
  // 与 TenantForm 中的 ID_CARD_FRAME 一致
  const FRAME = { x: 0.08, y: 0.147, w: 0.84, h: 0.706 };

  test('容器与视频同宽高比：按比例映射、无偏移', () => {
    // 容器 400×300、视频 800×600，object-fit: cover → scale 0.5，偏移 0
    const r = mapCoverCrop(FRAME, { width: 400, height: 300 }, { width: 800, height: 600 });
    eq(Math.round(r.x), 64, 'x = 0.08 × 400 ÷ 0.5');
    eq(Math.round(r.width), 672, '宽 = 0.84 × 400 ÷ 0.5');
    ok(Math.abs(r.width / 800 - 0.84) < 1e-6, '裁剪宽度应占视频宽 84%');
    ok(Math.abs(r.height / 600 - 0.706) < 1e-6, '裁剪高度应占视频高 70.6%');
  });

  test('视频更宽（cover 裁掉左右）：需减去被裁掉的偏移', () => {
    // 容器 400×300、视频 1600×600 → scale 0.5，左右各被裁掉 200 容器像素
    const r = mapCoverCrop(FRAME, { width: 400, height: 300 }, { width: 1600, height: 600 });
    eq(Math.round(r.x), 464, 'x = (0.08×400 + 200) ÷ 0.5');
    ok(r.x >= 0 && r.x + r.width <= 1600, '必须落在视频范围内');
  });

  test('视频更高（cover 裁掉上下）：y 方向偏移正确', () => {
    const r = mapCoverCrop(FRAME, { width: 400, height: 300 }, { width: 600, height: 800 });
    ok(r.y > 0, '应跳过顶部被裁掉的部分');
    ok(r.y + r.height <= 800, '必须落在视频范围内');
  });

  test('任意视频比例下裁剪矩形都不得越界', () => {
    const videos = [
      { width: 100, height: 2000 },
      { width: 2000, height: 100 },
      { width: 1, height: 1 },
      { width: 800, height: 600 },
      { width: 4032, height: 3024 },
    ];
    for (const v of videos) {
      const r = mapCoverCrop(FRAME, { width: 400, height: 300 }, v);
      const tag = `${v.width}×${v.height}`;
      ok(r.x >= 0 && r.y >= 0, `${tag}: x/y 不得为负`);
      ok(r.x + r.width <= v.width + 1e-6, `${tag}: 不得超出右边界`);
      ok(r.y + r.height <= v.height + 1e-6, `${tag}: 不得超出下边界`);
      ok(r.width >= 1 && r.height >= 1, `${tag}: 尺寸至少 1px`);
      ok(Number.isFinite(r.x) && Number.isFinite(r.y), `${tag}: 不得出现 NaN`);
    }
  });

  test('退化的容器尺寸不得产生 NaN 或负尺寸', () => {
    const r = mapCoverCrop(FRAME, { width: 0, height: 0 }, { width: 800, height: 600 });
    ok(Number.isFinite(r.x) && Number.isFinite(r.y), '不应出现 NaN');
    ok(r.width >= 1 && r.height >= 1, '尺寸应为正数');
  });

  test('取景框越小，裁剪出的区域越小（保证框真的在起作用）', () => {
    const big = mapCoverCrop({ x: 0, y: 0, w: 1, h: 1 }, { width: 400, height: 300 }, { width: 800, height: 600 });
    const small = mapCoverCrop({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { width: 400, height: 300 }, { width: 800, height: 600 });
    ok(small.width < big.width && small.height < big.height, '小框应裁出更小区域');
    eq(Math.round(big.width), 800, '整框应等于视频宽度');
    eq(Math.round(small.width), 160, '小框宽度应为 0.2 × 800');
  });
});