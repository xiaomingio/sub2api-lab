/*
 * 文件说明: 余额设置工作区，负责选择账号并提交余额恢复。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeInitialBalance } from "../../shared/allocation.js";
import type { BalanceAccount } from "../../shared/allocation.js";
import { restoreBalances } from "../api.js";
import { AccountPicker, accountName, selectedAccounts, sortAccountsByCurrentBalanceDesc } from "./shared.js";
import { formatSystemBalance } from "../format.js";
import type { DashboardData, RestoreResult } from "../types.js";

export function BalanceSettingsTab(props: { data: DashboardData; onRefresh: () => void }) {
  const [targetBalance, setTargetBalance] = useState(props.data.defaults.restoreTargetBalance);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ state: "success" | "warning" | "error"; text: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sortedAccounts = useMemo(() => sortAccountsByCurrentBalanceDesc(props.data.balanceAccounts), [props.data.balanceAccounts]);
  const selected = selectedAccounts(props.data.balanceAccounts, selectedUserIds);
  const canSubmit = props.data.restore.enabled && selected.length > 0 && Boolean(normalizeInitialBalance(targetBalance));

  useEffect(() => {
    if (confirming) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [confirming]);

  async function submitRestore() {
    setConfirming(false);
    setSubmitting(true);
    setResult({ state: "warning", text: "正在调用 Sub2API 管理接口写入所选账号余额。" });
    try {
      const payload = await restoreBalances({
        targetBalance,
        userIds: selected.map((account) => account.userId)
      });
      setResult(summarizeRestoreResult(props.data.balanceAccounts, payload));
    } catch (error) {
      setResult({ state: "error", text: error instanceof Error ? error.message : "写入失败，请稍后重试。" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="tab-panel is-active" aria-label="余额设置">
      <div className="section-intro">
        <p>
          下月开用前使用：只把勾选账号的系统余额覆盖为新的目标额度，未选择账号不会变化；提交前会再次确认，不影响成本分摊页的计算结果。
        </p>
      </div>

      {!props.data.restore.enabled ? <div className="status-message is-warning">{props.data.restore.disabledReason}</div> : null}

      <section className="tool-panel">
        <div className="form-grid">
          <label>
            <span>下月新系统额度</span>
            <input
              value={targetBalance}
              inputMode="decimal"
              disabled={!props.data.restore.enabled}
              onChange={(event) => setTargetBalance(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => setConfirming(true)}
          >
            {submitting ? "写入中" : "设置所选账号"}
          </button>
          <button className="ghost-button" type="button" onClick={props.onRefresh}>
            刷新当前余额
          </button>
        </div>
        <AccountPicker
          accounts={sortedAccounts}
          selectedUserIds={selectedUserIds}
          disabled={!props.data.restore.enabled || submitting}
          sortDescription="按当前系统余额从高到低排列"
          onChange={setSelectedUserIds}
        />
        {result ? <div className={`status-message is-${result.state}`}>{result.text}</div> : null}
      </section>

      <dialog className="confirm-dialog" ref={dialogRef} onCancel={() => setConfirming(false)}>
        <form method="dialog">
          <h2>确认设置系统余额</h2>
          <p>
            将把 {selected.length} 个账号的系统余额覆盖为 {formatSystemBalance(targetBalance)}。这会写入 Sub2API 并记录余额调整历史：
            {selected.map(accountName).join("、")}
          </p>
          <div className="dialog-actions">
            <button className="ghost-button" value="cancel" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button className="primary-button" value="confirm" onClick={() => void submitRestore()}>
              确认写入
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function summarizeRestoreResult(accounts: BalanceAccount[], payload: RestoreResult) {
  const accountById = new Map(accounts.map((account) => [account.userId, account]));
  const updatedNames = payload.updatedUserIds.map((userId) => accountName(accountById.get(userId) || { userId, email: "", username: "" }));
  const parts = [];
  if (payload.updatedUserIds.length > 0) {
    parts.push(`已恢复 ${payload.updatedUserIds.length} 个账号：${updatedNames.join("、")}`);
  }
  if (payload.unchangedUserIds.length > 0) {
    parts.push(`已有 ${payload.unchangedUserIds.length} 个账号本来就是目标额度`);
  }
  if (payload.failures.length > 0) {
    parts.push(
      `失败 ${payload.failures.length} 个：${payload.failures
        .map((failure) => `${failure.displayName || `用户 #${failure.userId}`}（${failure.reason || "原因未知"}）`)
        .join("、")}`
    );
  }
  parts.push("当前页面保留写入前快照，主动刷新后可查看最新系统余额。");
  return {
    state: payload.failures.length > 0 ? "warning" : "success",
    text: parts.join("；")
  } as const;
}
