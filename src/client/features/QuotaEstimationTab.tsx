/*
 * 文件说明: 展示各账号单模型的七天窗口容量、有效样本和估算误差，提供时间范围与模型筛选。
 */
import { useEffect, useState } from "react";
import { fetchQuotaEstimation } from "../api.js";
import { LoadingSection } from "../components/LoadingSection.js";
import { formatTokenAmount } from "../format.js";
import { estimationRanges } from "../../shared/quota-estimation.js";
import type { AccountEstimate, EstimationHours, ModelEstimate, QuotaEstimation } from "../../shared/quota-estimation.js";
import "./QuotaEstimationTab.css";

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const amount = (n: number | null) => n === null ? "—" : formatTokenAmount(n);
const date = (s: string | null, timezone: string) => s ? new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s)) : "—";
const tokenTypes = [{ key: "input", label: "输入" }, { key: "output", label: "输出" }, { key: "cacheRead", label: "缓存读取" }, { key: "cacheCreation", label: "缓存创建" }] as const;
type TokenType = typeof tokenTypes[number]["key"];
function officialPrice(model: ModelEstimate, type: TokenType): number | null {
  const pricing = model.officialPricing;
  if (!pricing) return null;
  return type === "input" ? pricing.inputPrice : type === "output" ? pricing.outputPrice : type === "cacheRead" ? pricing.cacheReadPrice : pricing.cacheWritePrice;
}
function officialPriceDisplay(price: number): string {
  return money(price * 1_000_000);
}
function money(value: number): string {
  return value.toFixed(4).replace(/\.?(0+)$/, "");
}
export function QuotaEstimationTab() {
  const [hours, setHours] = useState<EstimationHours>(() => {
    const value = Number(new URLSearchParams(window.location.search).get("hours"));
    return value === 24 || value === 72 || value === 168 ? value : 720;
  });
  const [data, setData] = useState<QuotaEstimation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [accountId, setAccountId] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "estimation"); url.searchParams.set("hours", String(hours));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setLoading(true); setError("");
    void fetchQuotaEstimation(hours, controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "加载额度估算失败，请重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hours, refresh]);
  const accounts = data?.accounts.filter((a) => accountId === "all" || String(a.accountId) === accountId) || [];
  return <div className="estimation-workspace">
    <section className="card" aria-labelledby="estimation-title">
      <div className="card-header estimation-heading">
        <div><h2 id="estimation-title">单模型额度估算</h2></div>
        <button type="button" className="ghost-button" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>刷新估算</button>
      </div>
      <div className="card-body estimation-controls">
        <div className="segmented-control" aria-label="分析时间范围">{estimationRanges.map((range) => <button type="button" key={range.hours} aria-pressed={hours === range.hours} className={hours === range.hours ? "is-active" : ""} onClick={() => setHours(range.hours)}>{range.label}</button>)}</div>
        <label className="estimation-account">上游账号<select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="all">全部账号 · 分别计算</option>{data?.accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.accountName} #{a.accountId}</option>)}</select></label>
        <label className="estimation-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />显示全部模型</label>
        <label className="estimation-toggle"><input type="checkbox" checked={showBilling} onChange={(e) => setShowBilling(e.target.checked)} />按 Token 类型分别计算</label>
      </div>
    </section>
    {error ? <div className="status-message is-error" role="alert">{data ? "更新失败，当前保留上次结果。" : ""}{error}<button type="button" className="ghost-button" onClick={() => setRefresh((n) => n + 1)}>重试</button></div> : null}
    {loading && !data ? <LoadingSection /> : null}
    {data ? <>
      <p className="estimation-note" role="status">{loading ? "正在更新，当前显示上次结果。" : ""}当前结果：最近 {data.hours / 24} 天，{date(data.start, data.timezone)} — {date(data.end, data.timezone)}（{data.timezone}）。默认展示 Token 用量最高的前 5 个模型，全部模型参与拟合。</p>
      {accounts.length ? accounts.map((account) => <AccountResult key={account.accountId} account={account} showAll={showAll} showBilling={showBilling} timezone={data.timezone} />) : <section className="card"><div className="card-body">暂无上游账号，请检查账号配置或选择全部账号。</div></section>}
    </> : null}
    <section className="card" aria-label="估算口径"><div className="card-body"><details className="estimation-method"><summary>计算方法与结果说明</summary>
      <p>每个账号独立计算。按上游用量更新时间匹配日志，相邻有效区间合并至约 3 小时；跨重置及重置所在整小时、缺失或异常快照、超过 6 小时的观测间隔均丢弃。时间范围外的区间不参与计算。</p>
      <p>所有模型的总 Token 参与稳健非负加权最小二乘：额度增量 ≈ 各模型百万 Token × 消耗系数。完整窗口容量 = 100 ÷ 消耗系数。小于等于 10% 的模型仅默认隐藏，不从拟合中删除。</p>
      <p>区间为连续时段成块重采样 80 次得到的 5%～95% 容量范围，仅反映样本波动。预测误差为前 75% 时段拟合后，预测后 25% 时段的绝对误差总和 ÷ 实际额度增量。</p>
      <p>按 Token 类型计算时，仅拟合有用量的类型，至少需要 8 个时段且每个参与类型平均 3 个时段，并单独检查后续预测误差。</p>
      <p>至少需要 8 个有效时段、每个模型平均 3 个时段及累计 5 个百分点消耗，并检查模型用量是否能区分。缺少可靠证据时不提供容量；误差、区间或用量结构波动较大时标记不稳定。未记入日志的账号用量、服务档位和平台规则变化可能造成额外偏差。结果不代表官方固定额度，也不保证可绕过 5 小时限额。</p>
    </details></div></section>
  </div>;
}

function AccountResult({ account, showAll, showBilling, timezone }: { account: AccountEstimate; showAll: boolean; showBilling: boolean; timezone: string }) {
  const models = showAll ? account.models : account.models.slice(0, 5);
  const validationError = showBilling ? account.tokenValidationError : account.validationError;
  return <section className="card" aria-labelledby={`estimate-account-${account.accountId}`}>
    <div className="card-header estimation-heading"><h2 id={`estimate-account-${account.accountId}`}>{account.accountName} <span className="estimation-note">#{account.accountId}</span></h2><span className="estimation-note">有效记录 {date(account.start, timezone)} — {date(account.end, timezone)}</span></div>
    <div className="card-body estimation-stats">
      <div><span>有效覆盖</span><strong>{account.effectiveHours.toFixed(1)} 小时</strong></div>
      <div><span>有效时段</span><strong>{account.samples}</strong></div>
      <div><span>额度增量</span><strong>{account.percent.toFixed(1)} 个百分点</strong></div>
      <div><span>丢弃观测区间</span><strong>{account.discardedIntervals}</strong></div>
      <div><span>后续时段预测误差</span><strong>{validationError === null ? "暂不可验证" : percent(validationError)}</strong></div>
    </div>
    {account.reasons.length ? <p className="estimation-note estimation-explanation">{account.reasons.join("；")}。</p> : null}
    <div className="card-body card-body-flush table-body"><div className="table-wrap"><table className="estimation-table">
      <thead><tr><th>模型</th><th>Token 类型</th><th className="num">样本 Token</th><th className="num">完整窗口 Token</th><th>Token 类型平均占比</th><th className="num">官方价格($/M) / 预估金额($)</th><th>判断依据</th></tr></thead>
      <tbody>{models.length ? models.flatMap((m) => (showBilling ? tokenTypes : [null]).map((type, index) => { const tokenKey = type?.key; const sample = tokenKey ? m[tokenKey] : m.totalTokens; const tokenEstimate = tokenKey ? m.tokenEstimates.find((item) => item.tokenType === tokenKey) : null; const projected = tokenKey ? tokenEstimate?.capacity ?? null : m.capacity; const status = tokenEstimate?.status ?? m.status; const reasons = tokenEstimate?.reasons ?? m.reasons; const details = tokenTypes.map((item) => { const price = officialPrice(m, item.key); const quantity = (m.capacity ?? 0) * m[item.key] / Math.max(1, m.totalTokens); return { label: item.label, price, revenue: price === null || m.capacity === null ? null : quantity * price }; }); const revenue = details.some((item) => item.revenue !== null) ? details.reduce((sum, item) => sum + (item.revenue ?? 0), 0) : null; const price = tokenKey ? officialPrice(m, tokenKey) : null; const typeRevenue = tokenKey && projected !== null && price !== null ? projected * price : null; return <tr key={`${m.model}-${tokenKey || "total"}`}><td>{index === 0 ? <><strong>{m.model}</strong>{!showBilling ? <span className={`estimation-status${status === "参考估算" ? " is-stable" : ""}`}>{status}</span> : null}</> : null}</td><td>{type?.label || "总 Token"}{showBilling ? <span className="estimation-status">{status}</span> : null}</td><td className="num">{amount(sample)}</td><td className="num strong">{amount(projected)}</td><td className="estimation-note">{!showBilling ? <span className="estimation-share-list">{tokenTypes.map((item) => <span key={item.key}><span>{item.label}</span><strong>{percent(m[item.key] / Math.max(1, m.totalTokens))}</strong></span>)}</span> : ""}</td><td className="num estimation-revenue">{showBilling ? (price === null ? "—" : `${officialPriceDisplay(price)} / ${typeRevenue === null ? "—" : money(typeRevenue)}`) : <>{details.map((item) => <span key={item.label}>{item.label} {item.price === null || item.revenue === null ? "—" : `${officialPriceDisplay(item.price)} / ${money(item.revenue)}`}</span>)}<strong>{revenue === null ? "合计 —" : `合计 ${money(revenue)}`}</strong></>}</td><td className="estimation-reasons">{index === 0 || showBilling ? (reasons.length ? reasons.join("；") : "通过样本与预测检查，按当前用量结构参考") : null}</td></tr>; })) : <tr><td colSpan={7} className="empty-cell">{account.models.length ? "暂无可显示模型。" : "暂无有效模型用量。可扩大时间范围，或等待额度快照与使用记录积累。"}</td></tr>}</tbody>
    </table></div></div>
  </section>;
}
