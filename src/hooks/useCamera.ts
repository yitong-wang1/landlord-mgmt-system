/**
 * useCamera：调用设备摄像头拍照（getUserMedia）。
 *
 * 在 Android WebView / 浏览器中作为「拍照兜底通道」。
 * 优先后置摄像头（facingMode: environment），失败回退任意摄像头。
 * 失败时不阻塞主流程——调用方可降级为「上传图片」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * 取景框矩形：均为相对「取景容器」的百分比（0~1），与容器像素尺寸无关。
 * 这样 UI 上画的框与裁剪时的坐标天然一致，不受屏幕尺寸/缩放影响。
 */
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把「容器内百分比矩形」换算成「视频原始像素矩形」。
 *
 * 前提：视频以 object-fit: cover 铺满容器（这是本项目的用法）。
 * cover 的换算：scale = max(cw/vw, ch/vh)，居中放置后会有负偏移量。
 * 纯函数，便于单测——坐标换算错了会导致裁到错误区域，必须可测。
 */
export function mapCoverCrop(
  frac: FrameRect,
  container: { width: number; height: number },
  video: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const cw = Math.max(1, container.width);
  const ch = Math.max(1, container.height);
  const vw = Math.max(1, video.width);
  const vh = Math.max(1, video.height);

  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale; // 视频被 cover 后的显示尺寸
  const dh = vh * scale;
  const ox = (cw - dw) / 2; // 负值：视频超出容器的部分
  const oy = (ch - dh) / 2;

  // 容器坐标下的框，换算回视频原始坐标
  const px = frac.x * cw;
  const py = frac.y * ch;
  const pw = frac.w * cw;
  const ph = frac.h * ch;

  let x = (px - ox) / scale;
  let y = (py - oy) / scale;
  let width = pw / scale;
  let height = ph / scale;

  // 夹到视频边界内（cover 下框一定在可见区内，这里只是数值兜底）
  x = Math.max(0, Math.min(vw - 1, x));
  y = Math.max(0, Math.min(vh - 1, y));
  width = Math.max(1, Math.min(vw - x, width));
  height = Math.max(1, Math.min(vh - y, height));

  return { x, y, width, height };
}

export interface CameraController {
  /** 取景容器（必须与 <video> 盒子一致，且 video 用 object-fit: cover） */
  containerRef: RefObject<HTMLDivElement>;
  videoRef: RefObject<HTMLVideoElement>;
  /** 是否正在取景 */
  active: boolean;
  /** 摄像头错误信息 */
  error: string | null;
  /** 当前取景分辨率（抓拍后可用于判断是否过低）；未知为 null */
  resolution: { width: number; height: number } | null;
  /** 启动取景 */
  start: () => Promise<void>;
  /** 停止取景 */
  stop: () => void;
  /** 抓拍整幅画面，返回 JPEG Blob（失败返回 null） */
  capture: () => Promise<Blob | null>;
  /**
   * 只抓拍取景框内的区域（按 frac 指定的百分比矩形），返回 JPEG Blob。
   * 用于「只识别框内内容」——裁掉无关背景后，证件在画面中占比更大，识别率显著提升。
   */
  captureRegion: (frac: FrameRect) => Promise<Blob | null>;
}

export function useCamera(): CameraController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    setResolution(null);
  }, []);

  const attach = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* 自动播放被拦截时忽略，取景仍可手动开始 */
      }
    }
    // 记录实际取景分辨率（OCR 需要足够分辨率才能识别证件上的小字）
    const track = stream.getVideoTracks()[0];
    const s = track?.getSettings?.();
    if (s?.width && s?.height) {
      setResolution({ width: s.width, height: s.height });
    }
    setActive(true);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前环境不支持摄像头，请改用「上传图片」');
      return;
    }
    // 关键：必须显式请求高分辨率。不指定时浏览器常默认 640×480，
    // 证件上的小字会糊成一团，OCR 会识别出完全不相干的字。
    const high: MediaTrackConstraints = {
      facingMode: { ideal: 'environment' },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    };
    try {
      let stream: MediaStream | null = null;
      for (const constraints of [
        high,
        { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { facingMode: { ideal: 'environment' } },
        true as unknown as MediaTrackConstraints,
      ]) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
          break;
        } catch {
          /* 换下一组约束重试 */
        }
      }
      if (!stream) throw new Error('所有约束均失败');
      await attach(stream);
    } catch (err) {
      console.warn('[useCamera] 启动摄像头失败', err);
      setError('无法访问摄像头（可能未授权），请改用「上传图片」');
      setActive(false);
    }
  }, [attach]);

  const capture = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        resolve(null);
        return;
      }
      // 以实际画面尺寸为准（可能与 getSettings 报告的不一致）
      setResolution({ width: video.videoWidth, height: video.videoHeight });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
    });
  }, []);

  /** 只抓拍取景框内的区域：裁掉背景后，证件在画面中占比更大，OCR 小字更准 */
  const captureRegion = useCallback((frac: FrameRect): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        resolve(null);
        return;
      }
      setResolution({ width: video.videoWidth, height: video.videoHeight });

      const container = containerRef.current;
      const cw = container?.clientWidth || video.clientWidth;
      const ch = container?.clientHeight || video.clientHeight;
      if (!cw || !ch) {
        resolve(null);
        return;
      }

      const rect = mapCoverCrop(
        frac,
        { width: cw, height: ch },
        { width: video.videoWidth, height: video.videoHeight },
      );

      const canvas = document.createElement('canvas');
      // 按原始像素 1:1 裁剪（不在这里放大，交给 OCR 前的 enhanceForOcr 统一处理，避免二次插值模糊）
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        video,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
    });
  }, []);

  useEffect(() => {
    // 取景框/视频元素是在 active 变为 true 之后才挂载的，
    // 而 attach() 执行时 videoRef.current 还是 null，所以这里必须在渲染后补挂一次，
    // 否则会出现「已开启摄像头但画面全黑」。
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {
        /* 自动播放被拦截时忽略 */
      });
    }
  }, [active]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    containerRef,
    videoRef,
    active,
    error,
    resolution,
    start,
    stop,
    capture,
    captureRegion,
  };
}