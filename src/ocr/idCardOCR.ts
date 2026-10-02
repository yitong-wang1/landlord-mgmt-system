/**
 * 身份证 OCR（Tesseract.js，端侧 chi_sim）。
 *
 * ⚠️ 设计原则：OCR 仅作「辅助录入」——识别结果回填表单供人工核对修正，绝不作为权威值。
 * 中国身份证 OCR 对数字/姓名识别不稳定，准确率受光线角度影响大。识别失败时调用方需降级为手动录入。
 *
 * 离线资源（为 Android WebView 离线可用）：
 * 优先从本地 public/tesseract/ 加载 worker / wasm / 语言包；若本地资源缺失则回退 CDN。
 */
import Tesseract, { PSM } from 'tesseract.js';

export interface OcrResult {
  /** 原始识别文本 */
  rawText: string;
  /** 解析出的姓名（可能为空） */
  name?: string;
  /** 解析出的身份证号（可能为空） */
  idCard?: string;
  /** 是否至少解析出一项 */
  success: boolean;
  /**
   * 原始文本里是否含中文字符。
   * 用于区分两种失败：
   *  - false → 中文语言包（chi_sim）没加载成功，OCR 只会读数字/英文；
   *  - true  → 引擎正常，只是姓名字段没解析出来。
   */
  hasChinese: boolean;
  /** 识别耗时（毫秒），用于判断是否真的跑了识别 */
  elapsedMs?: number;
  /**
   * 增强前原图的宽度（像素）。
   * 低于约 1000px 时证件小字基本无法识别，应提示用户换用原生相机拍照。
   */
  sourceWidth?: number;
}

/** 本地离线资源目录（public/tesseract）。使用绝对路径，避免 SPA 非根路由下相对路径解析错误。 */
const LOCAL = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/',
  langPath: '/tesseract/lang',
};

/** 身份证上出现在姓名前后的字段名/常见词，用于把「姓名」候选串截断 */
const NAME_STOPWORDS = [
  '性别',
  '民族',
  '出生',
  '住址',
  '公民',
  '身份',
  '号码',
  '有效',
  '期限',
  '签发',
  '机关',
  '男',
  '女',
];

/**
 * 从候选串里挑出中文姓名。
 * 中国身份证姓名 2~4 字，且后面通常紧跟「性别/民族/出生/住址…」等字段名，
 * OCR 常把它们连在一起（如「张三性别男」），需在此截断。
 */
function pickChineseName(raw: string): string | undefined {
  const s = raw.replace(/[^\u4e00-\u9fa5]/g, '');
  if (!s) return undefined;
  // 整串以字段名开头 → 不是姓名
  if (NAME_STOPWORDS.some((w) => s.startsWith(w))) return undefined;

  let cut = Math.min(s.length, 4);
  for (const w of NAME_STOPWORDS) {
    const i = s.indexOf(w);
    if (i > 0 && i < cut) cut = i;
  }
  const name = s.slice(0, cut);
  return name.length >= 2 ? name : undefined;
}

/**
 * 从文本解析姓名。
 * 适配常见排版：
 *  - 「姓名 张三」/「姓名：张三」/「姓名张三」
 *  - OCR 把姓名拆开：「姓 张 名 三」/「姓 名 张 三」
 *  - 与后续字段粘连：「姓名张三性别男」→ 张三
 *  - OCR 把「姓名」标签认花，但姓名本身紧邻「性别/民族/出生/住址」→ 兜底识别
 */
export function parseName(text: string): string | undefined {
  // 全角空格/多空格规整，便于跨空白匹配
  const cleaned = text.replace(/[ \t\u3000]+/g, ' ');

  // 1) 姓名 张三 / 姓名：张三 / 姓名 张 三
  const m1 = cleaned.match(/姓\s*名[\s:：]*([\u4e00-\u9fa5\s]{2,12})/);
  if (m1) {
    const name = pickChineseName(m1[1].replace(/\s/g, ''));
    if (name) return name;
  }

  // 2) 姓名被拆成两行/两段：「姓 张 名 三」
  const sx = cleaned.match(/姓[\s:：]*([\u4e00-\u9fa5])/);
  const mx = cleaned.match(/名[\s:：]*([\u4e00-\u9fa5]{1,2})/);
  if (sx && mx) {
    const name = pickChineseName(sx[1] + mx[1]);
    if (name) return name;
  }

  // 3) 兜底：标签认花了，但姓名紧邻证件上的「性别/民族/出生/住址」字段
  //    身份证版式中姓名行后面紧跟性别行，这个位置关系比标签本身更稳。
  const NEIGHBOR = /([\u4e00-\u9fa5]{2,4})(?=\s*(?:性别|民族|出生|住址))/g;
  let mm: RegExpExecArray | null;
  while ((mm = NEIGHBOR.exec(cleaned)) !== null) {
    // 候选串可能把「姓名」标签一起粘进来（如「姓名张三」），剥掉再校验
    const cand = mm[1].replace(/^(?:姓名|姓|名)/, '');
    const name = pickChineseName(cand);
    if (name) return name;
  }

  return undefined;
}

/**
 * 从文本解析 18 位身份证号。
 * 两级容错：先按原文本去空白匹配；再退化为「去掉所有非数字/非X字符」后匹配，
 * 以容忍 OCR 在号码中夹入空格、点、竖线等噪声。
 */
export function parseIdCard(text: string): string | undefined {
  const compact = text.replace(/[\s\u3000]/g, '');
  const m1 = compact.match(/\d{17}[\dXx]/);
  if (m1) return m1[0].toUpperCase();

  const loose = text.replace(/[^\dXx]/g, '');
  const m2 = loose.match(/\d{17}[\dXx]/);
  if (m2) return m2[0].toUpperCase();

  return undefined;
}

/** 创建一个 worker，优先本地离线资源，失败回退 CDN。 */
async function createLocalFirstWorker(
  onProgress?: (progress: number) => void,
): Promise<Tesseract.Worker> {
  const logger = (m: { status?: string; progress?: number }) => {
    if (m.status === 'recognizing text' && onProgress && m.progress != null) {
      onProgress(m.progress);
    }
  };
  try {
    // 先试本地离线资源
    return await Tesseract.createWorker('chi_sim', 1, {
      workerPath: LOCAL.workerPath,
      corePath: LOCAL.corePath,
      langPath: LOCAL.langPath,
      logger,
    });
  } catch (localErr) {
    console.warn('[ocr] 本地离线资源加载失败，回退 CDN', localErr);
    return Tesseract.createWorker('chi_sim', 1, { logger });
  }
}

/** OCR 前把图片放大到的目标宽度（Tesseract 对过小的字识别极差） */
const OCR_TARGET_WIDTH = 1800;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/**
 * OCR 前的图像增强，针对"手机拍证件照"的典型问题：
 *  1. 分辨率不足 —— 证件上的姓名只有十几像素高，Tesseract 会"编"出毫不相干的字；
 *     → 先放大到 OCR_TARGET_WIDTH。
 *  2. 偏色/反光导致对比度低 —— → 转灰度 + 按 2%~98% 分位做对比度拉伸（避免被个别极值拉偏）。
 *
 * 拿不到 DOM（如测试环境）或处理失败时，原样返回，绝不因此中断 OCR。
 */
export async function enhanceForOcr(
  image: Blob | string,
): Promise<Blob | string | HTMLCanvasElement> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return image;

  const objectUrl = typeof image === 'string' ? null : URL.createObjectURL(image);
  try {
    const img = await loadImageElement(objectUrl ?? (image as string));
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return image;

    // 只放大不缩小：缩小会丢字，放大虽不增加信息但能让 Tesseract 的字号落在最佳区间
    const scale = Math.max(1, OCR_TARGET_WIDTH / naturalW);
    const w = Math.round(naturalW * scale);
    const h = Math.round(naturalH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return image;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // 灰度 + 直方图
    const gray = new Uint8ClampedArray(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[j] = g;
      hist[g] += 1;
    }

    // 取 2% / 98% 分位作为黑/白点，避免个别噪点把整体压扁
    const total = gray.length;
    const lowCount = total * 0.02;
    const highCount = total * 0.98;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= lowCount) {
        lo = v;
        break;
      }
    }
    acc = 0;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= highCount) {
        hi = v;
        break;
      }
    }
    const range = Math.max(1, hi - lo);

    for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
      const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / range)) | 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    // 顺带把增强后的尺寸带回去，供调用方判断分辨率是否过低
    (canvas as HTMLCanvasElement & { __sourceWidth?: number }).__sourceWidth = naturalW;
    return canvas;
  } catch (err) {
    console.warn('[ocr] 图像预处理失败，改用原图识别', err);
    return image;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * 识别身份证图像。
 * @param image Blob / File / 图片 URL
 * @param onProgress 进度回调（0~1）
 */
export async function recognizeIdCard(
  image: Blob | string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  // 先做图像增强（放大 + 灰度 + 对比度拉伸）再交给引擎。
  // 证件上的姓名只有十几像素高时，Tesseract 会识别出完全不相关的字，
  // 这一步是提升小字识别率最有效的措施。
  const enhanced = await enhanceForOcr(image);
  const sourceWidth = (enhanced as HTMLCanvasElement & { __sourceWidth?: number })
    .__sourceWidth;

  const worker = await createLocalFirstWorker(onProgress);
  try {
    // 保留词间空格：身份证为多行字段排版，保留间隔有助于「姓名」与后续字段分离
    try {
      await worker.setParameters({ preserve_interword_spaces: '1' });
    } catch {
      /* 部分版本不支持该参数，忽略即可 */
    }

    const startedAt = Date.now();

    // 第一遍：默认版面分析
    const first = await worker.recognize(enhanced);
    let rawText = first.data.text ?? '';
    let name = parseName(rawText);
    const idCard = parseIdCard(rawText);

    // 第二遍：首遍没拿到姓名但确实读到了中文，换「单块文本」版面切分再试一次。
    // 身份证是多列排版（文字 + 照片），不同切分方式结果差异很大，这一步能救回不少姓名。
    if (!name && /[\u4e00-\u9fa5]/.test(rawText)) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const second = await worker.recognize(enhanced);
        const text2 = second.data.text ?? '';
        const name2 = parseName(text2);
        rawText = `${rawText}\n\n—— 第二遍（单块版面 PSM 6）——\n${text2}`;
        if (name2) name = name2;
      } catch (retryErr) {
        console.warn('[ocr] 第二遍识别失败，使用第一遍结果', retryErr);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const hasChinese = /[\u4e00-\u9fa5]/.test(rawText);

    return {
      rawText,
      name,
      idCard,
      hasChinese,
      elapsedMs,
      sourceWidth,
      success: Boolean(name || idCard),
    };
  } finally {
    await worker.terminate();
  }
}