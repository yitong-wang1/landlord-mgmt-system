/**
 * TenantForm：新增/编辑租户表单（对话框）。
 *
 * - 身份证支持「拍照 OCR 辅助录入」（结果回填需人工核对），失败自动降级手动输入。
 * - 可勾选「保存证件照」：证件照统一加水印（时间+经纬度）+ SHA-256 防篡改。
 * - 缴费周期 月付/季付/年付；押金 月数 + 可退/抵扣 + 退租是否可扣款。
 * - 身份证存储为明文 + 脱敏展示字段（maskIdCard），符合产品决策。
 */
import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { DepositType, PaymentCycle, Room, Tenant } from '../../types';
import { useTenantStore } from '../../store/tenantStore';
import PhotoUpload, { type EvidencePhotoValue } from '../common/PhotoUpload';
import { yuanToCents, parseYuanInput, formatCents } from '../../utils/money';

interface TenantFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Tenant;
  rooms: Room[];
}

const CYCLE_OPTIONS: { value: PaymentCycle; label: string }[] = [
  { value: 'monthly', label: '月付' },
  { value: 'quarterly', label: '季付（预收三个月）' },
  { value: 'yearly', label: '年付（预收十二个月）' },
];

const DEPOSIT_OPTIONS: { value: DepositType; label: string }[] = [
  { value: 'refundable', label: '可退（退租时退还）' },
  { value: 'offset', label: '抵扣（用于抵扣欠费/水电）' },
];

/**
 * 身份证取景框（相对取景容器的百分比，容器固定 4:3）。
 * 按身份证标准比例 85.6 : 54 ≈ 1.585 设计：
 *   宽占 84% → 高 = 0.84 × 容器宽 ÷ 1.585；容器高 = 容器宽 × 3/4，
 *   故高占比 = 0.84 ÷ 1.585 ÷ 0.75 ≈ 0.706，居中即 y = (1 − 0.706) ÷ 2 ≈ 0.147。
 * 框内区域即为识别范围，框外一律不参与识别。
 */
const ID_CARD_FRAME = { x: 0.08, y: 0.147, w: 0.84, h: 0.706 };

export function TenantForm({ open, onClose, initial, rooms }: TenantFormProps) {
  const addTenant = useTenantStore((s) => s.addTenant);
  const updateTenant = useTenantStore((s) => s.updateTenant);

  const [name, setName] = useState('');
  const [idCard, setIdCard] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentCycle, setPaymentCycle] = useState<PaymentCycle>('monthly');
  const [depositMonths, setDepositMonths] = useState(1);
  /** 押金金额（元，文本，允许用户手工编辑） */
  const [depositAmountYuan, setDepositAmountYuan] = useState('');
  /** 用户是否手工改过金额；未改则由「月数 × 房间月租金」自动同步 */
  const [depositManual, setDepositManual] = useState(false);
  const [depositType, setDepositType] = useState<DepositType>('refundable');
  const [deductible, setDeductible] = useState(true);
  const [roomId, setRoomId] = useState('');
  const [savePhoto, setSavePhoto] = useState(true);
  const [photo, setPhoto] = useState<EvidencePhotoValue | null>(null);
  const [error, setError] = useState('');
  /** OCR 回填提示（信息类，不当作表单错误） */
  const [ocrMsg, setOcrMsg] = useState('');
  /** 最近一次 OCR 的原始文本（诊断用，「查看识别原文」按钮展示） */
  const [ocrRawText, setOcrRawText] = useState('');
  const [ocrRawOpen, setOcrRawOpen] = useState(false);

  // 打开时回填
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setIdCard(initial.idCard);
      setPhone(initial.phone);
      setPaymentCycle(initial.paymentCycle);
      setDepositMonths(initial.depositMonths);
      // 已存过金额：按「已敲定」处理，改月数/房间不自动覆盖，避免悄悄改掉约定的押金
      const hasAmount = typeof initial.depositAmount === 'number' && initial.depositAmount > 0;
      setDepositAmountYuan(hasAmount ? (initial.depositAmount! / 100).toFixed(2) : '');
      setDepositManual(hasAmount);
      setDepositType(initial.depositType);
      setDeductible(initial.depositDeductibleOnExit);
      setRoomId(initial.roomId ?? '');
      setSavePhoto(Boolean(initial.idCardPhotoId));
      setPhoto(
        initial.idCardPhotoId
          ? {
              photoId: initial.idCardPhotoId,
              photoHash: initial.idCardPhotoHash ?? '',
              capturedAt: initial.idCardCapturedAt ?? initial.createdAt,
              lat: initial.idCardLat ?? null,
              lng: initial.idCardLng ?? null,
            }
          : null,
      );
    } else {
      setName('');
      setIdCard('');
      setPhone('');
      setPaymentCycle('monthly');
      setDepositMonths(1);
      setDepositAmountYuan('');
      setDepositManual(false);
      setDepositType('refundable');
      setDeductible(true);
      setRoomId('');
      setSavePhoto(true);
      setPhoto(null);
    }
    setError('');
    setOcrMsg('');
  }, [open, initial]);

  /** 按「押金月数 × 房间月租金」自动填充金额（用户已手改且未强制时不覆盖） */
  function autoFillDeposit(months: number, roomIdValue: string, force = false) {
    if (depositManual && !force) return;
    const room = rooms.find((r) => r.id === roomIdValue);
    if (!room) return;
    setDepositAmountYuan(((room.monthlyRent / 100) * months).toFixed(2));
  }

  /**
   * OCR 结果回填：
   * - 引擎跑通 → 空字段自动填入；已填但不一致时提示，不静默覆盖用户输入。
   * - 低分辨率等风险以「提示」形式附加，不阻断回填。
   */
  function applyOcrResult(r: {
    name?: string;
    idCard?: string;
    rawText?: string;
    hasChinese?: boolean;
    sourceWidth?: number;
    ok: boolean;
  }) {
    setOcrRawText(r.rawText ?? '');

    if (!r.ok) {
      setOcrMsg('OCR 引擎未能运行（可能是离线资源缺失），请重试或直接手动填写。');
      return;
    }

    const tips: string[] = [];
    // 分辨率过低是"识别出完全不相干的字"的首要原因
    if (r.sourceWidth !== undefined && r.sourceWidth < 1000) {
      tips.push(
        `照片分辨率偏低（${r.sourceWidth}px 宽），证件小字容易被识别错，建议靠近证件重拍或改用「上传图片」选高清原图`,
      );
    }

    const filled: string[] = [];
    const kept: string[] = [];
    if (r.name) {
      if (!name.trim()) {
        setName(r.name);
        filled.push(`姓名「${r.name}」`);
      } else if (name.trim() !== r.name) {
        kept.push(`姓名识别为「${r.name}」（已保留你填写的内容）`);
      }
    }
    if (r.idCard) {
      if (!idCard.trim()) {
        setIdCard(r.idCard);
        filled.push(`身份证号「${r.idCard}」`);
      } else if (idCard.trim() !== r.idCard) {
        kept.push(`身份证号识别为「${r.idCard}」（已保留你填写的内容）`);
      }
    }

    const head = filled.length
      ? `已回填 ${filled.join('、')}，请核对。`
      : kept.length
        ? `OCR 提示：${kept.join('；')}。`
        : r.hasChinese === false
          ? 'OCR 未读取到任何中文（很可能是中文语言包未加载成功），请检查网络后重试，或手动填写。'
          : 'OCR 读到了文字但未能定位姓名，常见原因是反光、倾斜或字号过小。请对准证件、避免反光后重试，可点「查看识别原文」排查。';

    const tail = tips.length ? `\n注意：${tips.join('；')}。` : '';
    setOcrMsg(`${head}${tail}`);
  }

  // 可选房间：空置 + 当前房间
  const roomOptions = useMemo(
    () => rooms.filter((r) => r.status === 'vacant' || r.id === initial?.roomId),
    [rooms, initial],
  );

  /** 当前选中的房间（用于押金自动计算） */
  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId), [rooms, roomId]);

  /** 押金建议金额（分）：月数 × 房间月租金 */
  const suggestedDepositCents = selectedRoom
    ? selectedRoom.monthlyRent * (Number(depositMonths) || 0)
    : 0;

  function handleSubmit() {
    if (!name.trim()) {
      setError('请填写姓名');
      return;
    }
    const depositCents = yuanToCents(parseYuanInput(depositAmountYuan));
    const payload = {
      name: name.trim(),
      idCard: idCard.trim(),
      phone: phone.trim(),
      paymentCycle,
      depositMonths: Number(depositMonths) || 0,
      // 押金金额：>0 时落库（把签约时约定的金额固定下来，避免日后租金变化影响押金口径）
      depositAmount: depositCents > 0 ? depositCents : undefined,
      depositType,
      depositDeductibleOnExit: deductible,
      roomId: roomId || undefined,
      // 勾选且已拍照 → 写入证件照；否则显式清空（避免取消勾选后旧照片仍留在档案里）
      ...(savePhoto && photo
        ? {
            idCardPhotoId: photo.photoId,
            idCardPhotoHash: photo.photoHash,
            idCardCapturedAt: photo.capturedAt,
            idCardLat: photo.lat,
            idCardLng: photo.lng,
          }
        : {
            idCardPhotoId: undefined,
            idCardPhotoHash: undefined,
            idCardCapturedAt: undefined,
            idCardLat: undefined,
            idCardLng: undefined,
          }),
    };
    if (initial) {
      updateTenant(initial.id, payload);
    } else {
      addTenant(payload);
    }
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle>{initial ? '编辑租户' : '新增租户'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {ocrMsg && (
            <Alert
              severity="info"
              sx={{ whiteSpace: 'pre-line' }}
              onClose={() => setOcrMsg('')}
              action={
                ocrRawText ? (
                  <Button color="inherit" size="small" onClick={() => setOcrRawOpen(true)}>
                    查看识别原文
                  </Button>
                ) : undefined
              }
            >
              {ocrMsg}
            </Alert>
          )}

          <TextField
            label="姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />

          <TextField
            label="身份证号"
            value={idCard}
            onChange={(e) => setIdCard(e.target.value)}
            fullWidth
            placeholder="18 位身份证号"
          />

          <TextField
            label="手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            fullWidth
          />

          <Divider>身份证识别 / 证件照（拍一次即可）</Divider>
          <FormControlLabel
            control={
              <Checkbox
                checked={savePhoto}
                onChange={(e) => setSavePhoto(e.target.checked)}
              />
            }
            label="同时留存证件照（叠加时间+经纬度水印 + SHA-256 校验）"
          />
          <Typography variant="caption" color="text.secondary">
            {savePhoto ? '拍照一次：识别并留存证件照。' : '拍照一次：仅识别，不留照片。'}
          </Typography>
          <PhotoUpload
            label="身份证拍照（识别 + 留存，一次完成）"
            value={savePhoto ? photo : null}
            onChange={setPhoto}
            withOcr
            persist={savePhoto}
            onOcr={applyOcrResult}
            captureFrame={ID_CARD_FRAME}
            frameLabel="把身份证放进框内，只识别框内内容"
            hint="让证件贴齐取景框，只识别框内；从相册选图则按整幅识别。识别结果请人工核对。"
          />

          <Divider>租赁与押金</Divider>
          <TextField
            select
            label="缴费周期"
            value={paymentCycle}
            onChange={(e) => setPaymentCycle(e.target.value as PaymentCycle)}
            fullWidth
          >
            {CYCLE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {(paymentCycle === 'quarterly' || paymentCycle === 'yearly') && (
            <Alert severity="info">
              季付/年付：预收租金覆盖整段周期，该周期不再出租金账单。
            </Alert>
          )}

          <TextField
            select
            label="关联房间"
            value={roomId}
            onChange={(e) => {
              const v = e.target.value;
              setRoomId(v);
              // 换房间后，押金金额按新房间租金重算（用户手工填过则不覆盖）
              autoFillDeposit(depositMonths, v);
            }}
            fullWidth
            helperText="一房一租户；关联后押金可按房间租金自动算"
          >
            <MenuItem value="">暂不关联</MenuItem>
            {roomOptions.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}（{r.status === 'rented' ? '已租' : '空置'}）
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="押金月数"
            type="number"
            value={depositMonths}
            onChange={(e) => {
              const m = Number(e.target.value);
              setDepositMonths(m);
              autoFillDeposit(m, roomId);
            }}
            fullWidth
            inputProps={{ min: 0, step: 1 }}
          />
          <TextField
            label="押金金额（元）"
            type="number"
            value={depositAmountYuan}
            onChange={(e) => {
              setDepositAmountYuan(e.target.value);
              setDepositManual(true);
            }}
            fullWidth
            inputProps={{ step: '0.01', min: 0 }}
            helperText={
              selectedRoom
                ? `${selectedRoom.name} 月租金 ${formatCents(selectedRoom.monthlyRent)}；按 ${
                    Number(depositMonths) || 0
                  } 个月应约 ${formatCents(suggestedDepositCents)}${
                    depositManual ? '（当前为手工填写）' : '（自动计算）'
                  }`
                : '未关联房间时无法按租金自动计算，请直接填写实际收取的押金金额'
            }
          />
          {depositManual && selectedRoom && (
            <Button
              size="small"
              onClick={() => {
                setDepositManual(false);
                autoFillDeposit(depositMonths, roomId, true);
              }}
            >
              按「{Number(depositMonths) || 0} 个月 × {selectedRoom.name} 租金」重算
            </Button>
          )}
          <TextField
            select
            label="押金类型"
            value={depositType}
            onChange={(e) => setDepositType(e.target.value as DepositType)}
            fullWidth
          >
            {DEPOSIT_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={deductible}
                onChange={(e) => setDeductible(e.target.checked)}
              />
            }
            label="退租时允许从押金中扣款"
          />

          <Typography variant="caption" color="text.secondary">
            提示：身份证明文存本机，展示已脱敏。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit} variant="contained" disableElevation>
          保存
        </Button>
      </DialogActions>
      </Dialog>

      {/* OCR 原文诊断：姓名没识别出来时，用来确认 OCR 到底读到了什么 */}
      <Dialog open={ocrRawOpen} onClose={() => setOcrRawOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>OCR 识别原文</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            以下是本次从照片中识别出的原始文字。若姓名未被填入，可把这段内容截图反馈，用于改进识别规则。
          </Typography>
          <Box
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
              fontSize: 12,
              bgcolor: 'action.hover',
              p: 1,
              borderRadius: 1,
              maxHeight: 320,
              overflow: 'auto',
              m: 0,
            }}
          >
            {ocrRawText || '（未识别到任何文字）'}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOcrRawOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default TenantForm;