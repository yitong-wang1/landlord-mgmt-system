/**
 * 跨 store 状态同步。
 *
 * 背景（这是一个真实踩过的 bug）：各 store 只在自己 load() 时从 repository 拉一次数据，
 * 之后互相之间不会自动感知对方的变化。于是出现：
 *   租户关联了房间 → repository 里房间已变「已出租」 → 但 roomStore 内存里仍是「空置」，
 *   房间页读的是 roomStore，于是显示空置。
 *
 * 解决：用一个**不依赖任何 store 的注册表**（本模块），各 store 在模块加载时把自己的
 * load 注册进来；任一 store 改动了「会影响其他实体」的数据后调用 reloadAll()，
 * 让所有 store 重新从 repository 读取，保证 UI 不残留过期状态。
 *
 * 这样避免了 store 之间相互 import 造成的循环依赖。
 */

type Loader = () => void;

const loaders = new Map<string, Loader>();

/** 注册一个 store 的加载函数（各 store 模块加载时调用一次即可） */
export function registerStore(name: string, load: Loader): void {
  loaders.set(name, load);
}

/**
 * 重新加载全部已注册的 store。
 * 单个 store 抛错不影响其他 store（同步失败不应连累整页崩溃）。
 */
export function reloadAll(): void {
  loaders.forEach((load) => {
    try {
      load();
    } catch (err) {
      console.warn('[store-sync] 重新加载失败：', err);
    }
  });
}

/** 仅供测试：清空注册表 */
export function __resetStoreRegistry(): void {
  loaders.clear();
}
