/*
 * 文件说明: 提供管理台各页面统一的数据加载状态 section。
 */

export function LoadingSection() {
  return <section className="card status-message loading-section" aria-label="数据加载状态" role="status"><div className="card-body">正在加载数据……</div></section>;
}
