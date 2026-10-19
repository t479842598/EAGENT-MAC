// 内嵌网页视图的落位约定。
//
// WebContentsView 是原生视图，层级永远高于渲染层 DOM，既不能用 CSS 定位，
// 也不能靠固定高度硬算 —— 顶栏、消息区、输入区的高度都会随内容与字体变化。
// 因此唯一真源是渲染层里那个占位 div 的 getBoundingClientRect()：
// 渲染层测量 → IPC 上报 → 主进程 setBounds。主进程只在窗口尺寸变化时
// 发一个 'page:relayout' 事件，让渲染层重新测量。

export const RELAYOUT_CHANNEL = 'page:relayout';

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
