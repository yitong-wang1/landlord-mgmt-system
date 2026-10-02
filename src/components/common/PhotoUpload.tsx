/**
 * PhotoUpload：取证照片采集/上传组件（电表照片、证件照共用）。
 *
 * 能力：
 * - 拍照（Android WebView 优先原生相机，浏览器用 getUserMedia）或从相册上传。
 * - 统一处理：叠加「时间 + 经纬度」水印 → 计算 SHA-256 → 存入 photoDB（原图不留存）。
 * - 展示带水印缩略图、拍摄时间、经纬度、SHA-256，并提供「校验」按钮验证图片未被替换。
 * - 可选：对证件照触发 OCR，回填姓名/身份证号（辅助，需人工核对）。
 */
import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import UploadFile from '@mui/icons-material/UploadFile';
import Verified from '@mui/icons-material/Verified';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Videocam from '@mui/icons-material/Videocam';
import { useCamera, type FrameRect } from '../../hooks/useCamera';
import { usePhoto, usePhotoUrl, isNativePlatform, captureNativePhoto, verifyPhotoIntegrity } from '../../hooks/usePhoto';
import { useOCR } from '../../hooks/useOCR';
import { formatGeo } from '../../utils/watermark';
import { formatDateTime } from '../../utils/date';

export interface EvidencePhotoValue {
  photoId: string;
  photoHash: string;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
}

interface PhotoUploadProps {
  label: string;
  value?: EvidencePhotoValue | null;
  onChange: (v: EvidencePhotoValue | null) => void;
  /** 是否对证件照触发 OCR */
  withOcr?: boolean;
  /**
   * OCR 结果回调。
   * - `ok`：OCR 引擎是否跑通（false 表示引擎/语言包失败，不是"没认出来"）
   * - `hasChinese`：原始文本是否含中文；false 说明中文语言包没加载成功
   * - `rawText`：原始识别文本，用于排查"为什么没识别出姓名"
   */
  onOcr?: (r: {
    name?: string;
    idCard?: string;
    rawText?: string;
    hasChinese?: boolean;
    /** 增强前原图宽度（像素）；过低说明拍照分辨率不足 */
    sourceWidth?: number;
    ok: boolean;
  }) => void;
  /**
   * 是否把照片落库留证（叠加水印 + 计算哈希）。
   * 为 false 时：仍然拍照并做 OCR 回填，但不保存任何照片（用于「只想识别、不想留照片」）。
   */
  persist?: boolean;
  /**
   * 取景框（相对取景容器的百分比矩形，0~1）。
   * 传入后：取景画面会显示该框、框外压暗，且**只抓拍并识别框内区域**——
   * 裁掉背景后证件占比更大，小字识别率显著提升。不传则维持整幅抓拍。
   */
  captureFrame?: FrameRect;
  /** 取景框上方的提示文案 */
  frameLabel?: string;
  /** 提示文案 */
  hint?: string;
}

export function PhotoUpload({
  label,
  value,
  onChange,
  withOcr,
  onOcr,
  persist = true,
  captureFrame,
  frameLabel,
  hint,
}: PhotoUploadProps) {
  const camera = useCamera();
  const { process, processing, error } = usePhoto();
  const ocr = useOCR();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const url = usePhotoUrl(value?.photoId);
  const [msg, setMsg] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const native = isNativePlatform();

  async function handleEvidence(raw: Blob) {
    // 拍照瞬间时间戳（保证水印时间贴近实际拍摄时刻）
    const capturedAt = new Date().toISOString();

    // 1) 先对「原图」做 OCR（辅助录入）——未加水印的原图识别率更高。
    //    识别结果的提示文案由调用方统一展示（避免同一件事两处报）。
    if (withOcr) {
      const r = await ocr.recognize(raw);
      onOcr?.({
        name: r?.name,
        idCard: r?.idCard,
        rawText: r?.rawText,
        hasChinese: r?.hasChinese,
        sourceWidth: r?.sourceWidth,
        ok: Boolean(r),
      });
    }

    // 2) 不留存（未勾选保存）→ 到此为止，不保存任何照片
    if (!persist) {
      setMsg('本次未勾选「留存证件照」，照片不会被保存。');
      return;
    }

    // 3) 留证：叠加水印 + 计算哈希 + 落库
    const saved = await process(raw, capturedAt);
    if (saved) {
      onChange({
        photoId: saved.photoId,
        photoHash: saved.evidence.hash,
        capturedAt: saved.evidence.capturedAt,
        lat: saved.evidence.lat,
        lng: saved.evidence.lng,
      });
      setMsg(null);
    }
  }

  /** 是否使用「自绘取景器 + 取景框」：设了取景框就走这条（原生端也优先用它，才能显示框） */
  const framed = Boolean(captureFrame);

  async function handleCapture(forceSystemCamera = false) {
    let raw: Blob | null = null;

    if (framed && !forceSystemCamera) {
      // 有取景框：走自绘取景器，只抓框内区域
      if (!camera.active) await camera.start();
      raw = await camera.captureRegion(captureFrame as FrameRect);
      if (!raw && native) {
        // WebView 内取景不可用时，退回系统相机（此时无法套用取景框）
        setMsg('应用内取景不可用，已改调系统相机（本次不套用取景框）。');
        raw = await captureNativePhoto();
      }
    } else if (native) {
      raw = await captureNativePhoto();
    } else {
      if (!camera.active) await camera.start();
      raw = await camera.capture();
    }

    if (!raw) {
      setMsg('未获取到照片，请重试');
      return;
    }
    await handleEvidence(raw);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // OCR 与留证统一走 handleEvidence，避免这里再单独跑一次 OCR（原来会重复识别两遍）
    await handleEvidence(f);
  }

  async function handleVerify() {
    if (!value) return;
    setVerifyMsg('校验中…');
    const res = await verifyPhotoIntegrity(value.photoId, value.photoHash);
    setVerifyMsg(res.ok ? '✅ 校验通过（图片未被替换）' : `⚠️ ${res.reason}`);
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" gutterBottom>
        {label}
      </Typography>

      {value?.photoId && url && (
        <Box sx={{ mb: 1 }}>
          <Box
            component="img"
            src={url}
            alt={label}
            sx={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 1, bgcolor: '#eee' }}
          />
          <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
            拍摄时间：{formatDateTime(value.capturedAt)} · 位置：
            {formatGeo(value.lat, value.lng)}
          </Typography>
          <Typography variant="caption" display="block" sx={{ wordBreak: 'break-all' }}>
            SHA-256：{value.photoHash?.slice(0, 24)}…
          </Typography>
        </Box>
      )}

      {/* 设了取景框时，原生端也渲染自绘取景器（系统相机无法叠加取景框） */}
      {camera.active && (framed || !native) && (
        framed ? (
          // 带取景框的取景器：框内为识别区域，框外压暗
          <Box
            ref={camera.containerRef}
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              bgcolor: '#000',
              borderRadius: 1,
              overflow: 'hidden',
              mb: 1,
            }}
          >
            <Box
              component="video"
              ref={camera.videoRef}
              playsInline
              muted
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {/* boxShadow 扩散值做出「框外压暗」效果 */}
            <Box
              sx={{
                position: 'absolute',
                left: `${captureFrame!.x * 100}%`,
                top: `${captureFrame!.y * 100}%`,
                width: `${captureFrame!.w * 100}%`,
                height: `${captureFrame!.h * 100}%`,
                border: '2px solid #fff',
                borderRadius: '6px',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                pointerEvents: 'none',
              }}
            />
            <Typography
              variant="caption"
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 6,
                textAlign: 'center',
                color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
              }}
            >
              {frameLabel ?? '将证件放入框内，只识别框内内容'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ mb: 1 }}>
            <Box
              component="video"
              ref={camera.videoRef}
              playsInline
              muted
              sx={{ width: '100%', borderRadius: 1, bgcolor: '#000', maxHeight: 260 }}
            />
          </Box>
        )
      )}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {framed ? (
          <>
            {!camera.active ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<Videocam />}
                onClick={camera.start}
                disabled={processing}
              >
                开启取景（显示取景框）
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                startIcon={<PhotoCamera />}
                onClick={() => handleCapture()}
                disabled={processing}
              >
                {withOcr ? '抓拍（只识别框内）' : persist ? '抓拍（只取框内）' : '抓拍框内（不留存）'}
              </Button>
            )}
            {/* 原生端保留系统相机作为兜底（不套用取景框） */}
            {native && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PhotoCamera />}
                onClick={() => handleCapture(true)}
                disabled={processing}
              >
                用系统相机拍摄
              </Button>
            )}
          </>
        ) : native ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<PhotoCamera />}
            onClick={() => handleCapture()}
            disabled={processing}
          >
            {withOcr ? (persist ? '拍照（识别＋留存）' : '拍照识别') : persist ? '拍照' : '拍照（不留存）'}
          </Button>
        ) : !camera.active ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<Videocam />}
            onClick={camera.start}
            disabled={processing}
          >
            开启摄像头
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            startIcon={<PhotoCamera />}
            onClick={() => handleCapture()}
            disabled={processing}
          >
            {withOcr ? (persist ? '抓拍（识别＋留存）' : '抓拍识别') : persist ? '抓拍并保存' : '抓拍（不留存）'}
          </Button>
        )}

        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFile />}
          onClick={() => fileRef.current?.click()}
          disabled={processing}
        >
          上传图片
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />

        {value?.photoId && (
          <>
            <Button size="small" startIcon={<Verified />} onClick={handleVerify}>
              校验
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutline />}
              onClick={() => {
                onChange(null);
                setVerifyMsg(null);
              }}
            >
              移除
            </Button>
          </>
        )}
        {camera.active && (framed || !native) && (
          <Button size="small" onClick={camera.stop}>
            关闭摄像头
          </Button>
        )}
      </Stack>

      {processing && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="caption">正在叠加水印并计算哈希…</Typography>
        </Stack>
      )}
      {withOcr && ocr.status === 'recognizing' && (
        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
          OCR 识别中 {Math.round(ocr.progress * 100)}%
        </Typography>
      )}
      {camera.error && <Alert severity="warning" sx={{ mt: 1 }}>{camera.error}</Alert>}
      {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
      {msg && <Alert severity="info" sx={{ mt: 1 }}>{msg}</Alert>}
      {verifyMsg && (
        <Alert severity={verifyMsg.startsWith('✅') ? 'success' : 'warning'} sx={{ mt: 1 }}>
          {verifyMsg}
        </Alert>
      )}
      {hint && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        </>
      )}
    </Paper>
  );
}

export default PhotoUpload;