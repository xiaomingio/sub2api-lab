/*
 * 文件说明: 复用额度分析和额度趋势中的账号窗口卡片。
 */

import { formatDateTimeWithoutYear, formatTokenAmount } from "../format.js";
import type { UsageAnalysisData } from "../types.js";

type Account = UsageAnalysisData["quota"]["accounts"][number];

function averagePercent(accounts: Account[], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): number {
  const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null);
  return values.length ? Math.min(100, Math.max(0, values.reduce((sum, value) => sum + value, 0) / values.length)) : 0;
}

function formatPercentAverage(accounts: Account[], key: "fiveHourUsedPercent" | "sevenDayUsedPercent"): string {
  const values = accounts.map((account) => account[key]).filter((value): value is number => value !== null);
  return values.length ? `${averagePercent(accounts, key).toFixed(0)}%` : "暂无数据";
}

function formatWindowRate(account: Account): string {
  return account.sevenDayUsedPercent === null ? "暂无数据" : `7d ${account.sevenDayUsedPercent.toFixed(0)}%`;
}

function formatWindowDate(value: string | null): string {
  return value ? formatDateTimeWithoutYear(value, "Asia/Shanghai") : "暂无数据";
}

function accountColor(accountId: number): string {
  return ["#2563eb", "#8b5cf6", "#059669", "#d97706", "#e11d48", "#64748b"][accountId % 6];
}

export function AccountWindowCard(props: { account: Account | null; accounts: Account[]; selected?: boolean; onSelect?: () => void }) {
  const account = props.account;
  const all = !account;
  const tokens = all ? props.accounts.reduce((sum, item) => sum + item.tokens, 0) : account.tokens;
  const cardContent = <>
    <span className="account-window-card-title">{all ? "全部账号" : <><i style={{ backgroundColor: accountColor(account.accountId) }} />{account.name}</>}</span>
    {all ? <span className="account-window-rate">{formatPercentAverage(props.accounts, "sevenDayUsedPercent")}</span> : <span className="account-window-rate">{formatWindowRate(account)}</span>}
    <span className="account-window-meter"><i style={{ width: `${all ? averagePercent(props.accounts, "sevenDayUsedPercent") : account.sevenDayUsedPercent || 0}%` }} /></span>
    <dl>
      <div><dt>下次重置</dt><dd>{all ? "多账号" : formatWindowDate(account.sevenDayResetAt)}</dd></div>
      <div><dt>本地 Token</dt><dd>{formatTokenAmount(tokens)}</dd></div>
    </dl>
  </>;
  const className = `account-window-card${all ? " account-window-all" : ""}${props.selected ? " is-selected" : ""}`;
  return props.onSelect ? <button className={className} type="button" onClick={props.onSelect}>{cardContent}</button> : <article className={className}>{cardContent}</article>;
}

export function AccountWindowCardList(props: { accounts: Account[]; visibleAccounts?: Account[]; selectedAccountId?: number | null; onSelect?: (accountId: number | null) => void }) {
  const visibleAccounts = props.visibleAccounts || props.accounts;
  return <div className="account-window-scroller"><AccountWindowCard account={null} accounts={props.accounts} selected={props.selectedAccountId === null} onSelect={props.onSelect ? () => props.onSelect?.(null) : undefined} />{visibleAccounts.map((account) => <AccountWindowCard key={account.accountId} account={account} accounts={props.accounts} selected={props.selectedAccountId === account.accountId} onSelect={props.onSelect ? () => props.onSelect?.(account.accountId) : undefined} />)}</div>;
}

export { formatWindowRate };
