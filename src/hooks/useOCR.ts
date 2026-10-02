/**
 * useOCR：身份证端侧 OCR 流程 hook。
 * 失败必须降级为手动录入（不阻塞主流程）。
 */
import { useCallback, useState } from 'react';
import { recognizeIdCard, type OcrResult } from '../ocr/idCardOCR';

export type OcrStatus = 'idle' | 'recognizing' | 'done' | 'error';

export interface UseOcrResult {
  status: OcrStatus;
  /** 进度 0~1 */
  progress: number;
  /** 最近一次结果 */
  result: OcrResult | null;
  /** 识别一帧图片；失败返回 null（调用方降级手动录入） */
  recognize: (image: Blob | string) => Promise<OcrResult | null>;
  reset: () => void;
}

export function useOCR(): UseOcrResult {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OcrResult | null>(null);

  const recognize = useCallback(
    async (image: Blob | string): Promise<OcrResult | null> => {
      setStatus('recognizing');
      setProgress(0);
      setResult(null);
      try {
        const res = await recognizeIdCard(image, setProgress);
        setResult(res);
        setStatus('done');
        setProgress(1);
        return res;
      } catch (err) {
        console.warn('[useOCR] 识别失败，降级为手动录入', err);
        setStatus('error');
        setProgress(0);
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setResult(null);
  }, []);

  return { status, progress, result, recognize, reset };
}