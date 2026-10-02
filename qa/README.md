# QA 测试套件（严过关 / Yan）

独立验证工程师自报，不依赖其结论。全部用例直接 import `src/` 下的真实源码执行。

## 运行

```bash
npm run typecheck          # 类型检查
npm run build              # 真实构建
node qa/run.cjs            # 跑测试（自动打包 + 执行）
```

## 结构

| 文件 | 覆盖范围 |
|---|---|
| `env.ts` | Node 下模拟 localStorage / crypto / Canvas / Image / geolocation |
| `harness.ts` | 极简断言与用例注册（环境无 vitest/jest） |
| `dataLayer.test.ts` | 金额精度、预收整周期、电费/供暖/自定义费用、押金隔离、换房数据完整性、repository |
| `watermark.test.ts` | 水印绘制、GPS 兜底、SHA-256 顺序、防篡改校验、OCR 资源路径与文件存在性 |
| `debug-room-swap.ts` | 换房 Bug 根因定位脚本（打印仓储真实状态） |
| `debug-prepaid.ts` | 预收整周期端到端逐月扫描（走真实 generateBill） |

## 约定

- 金额一律整数「分」，断言用 `eq`，不用浮点比较。
- 月份一律 `"YYYY-MM"`。
- 每个用例前 `resetStorage()`，保证独立与幂等。
