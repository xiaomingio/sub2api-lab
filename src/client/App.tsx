/*
 * 文件说明: 管理台应用壳，负责 Tab 导航、全局查询状态和页面级数据加载。
 */

import { useEffect, useRef, useState } from "react";
import { fetchDashboard, fetchUsageRecords } from "./api.js";
import { AllocationTab } from "./features/AllocationTab.js";
import { BalanceSettingsTab } from "./features/BalanceSettingsTab.js";
import { RecordsTab } from "./features/RecordsTab.js";
import { UsageTab } from "./features/UsageTab.js";
import {
  allocationSelectionKey,
  defaultAllocationSelectedUserIds,
  initialTab,
  initialUsageQuery,
  tabLabels,
  updateUrl
} from "./features/shared.js";
import type { DashboardData, DashboardTab, UsageQuery, UsageRecordsData } from "./types.js";

export function App() {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [usageQuery, setUsageQuery] = useState<UsageQuery>(initialUsageQuery);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<UsageRecordsData | null>(null);
  const [recordsLimit, setRecordsLimit] = useState(1000);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [allocationSelectedUserIds, setAllocationSelectedUserIds] = useState<Set<number>>(new Set());
  const allocationInitialized = useRef(false);
  const allocationSelectionKeyRef = useRef("");

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchDashboard(usageQuery);
      setData(payload);
      const nextAllocationSelectionKey = allocationSelectionKey(usageQuery);
      if (!allocationInitialized.current || allocationSelectionKeyRef.current !== nextAllocationSelectionKey) {
        setAllocationSelectedUserIds(defaultAllocationSelectedUserIds(payload, usageQuery.allocationBasis));
        allocationInitialized.current = true;
        allocationSelectionKeyRef.current = nextAllocationSelectionKey;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载数据失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    updateUrl(tab, usageQuery);
  }, [tab, usageQuery]);

  useEffect(() => {
    void loadDashboard();
  }, [usageQuery]);

  useEffect(() => {
    if (tab !== "records") return;
    setRecordsLoading(true);
    void fetchUsageRecords(usageQuery, recordsLimit)
      .then(setRecords)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "加载使用记录失败。"))
      .finally(() => setRecordsLoading(false));
  }, [recordsLimit, tab, usageQuery]);

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <h1>{data?.title || "Sub2API Lab"}</h1>
        </div>
        <div className="top-actions">
          <form method="post" action="logout">
            <button className="logout-button" type="submit">
              退出
            </button>
          </form>
        </div>
      </header>

      <nav className="tab-nav" aria-label="功能标签页">
        {Object.entries(tabLabels).map(([key, label]) => (
          <button
            className={`tab-link${tab === key ? " is-active" : ""}`}
            type="button"
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key as DashboardTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="page-content">
        {loading && !data ? <div className="status-message">正在加载数据。</div> : null}
        {error ? <div className="status-message is-error">{error}</div> : null}
        {data ? (
          <>
          {tab === "usage" ? (
            <UsageTab data={data} usageQuery={usageQuery} onUsageQueryChange={(query) => setUsageQuery(query)} />
          ) : null}
          {tab === "records" ? (
            <RecordsTab
              data={data}
              usageQuery={usageQuery}
              records={records}
              limit={recordsLimit}
              loading={recordsLoading}
              onLimitChange={setRecordsLimit}
              onUsageQueryChange={setUsageQuery}
            />
          ) : null}
          {tab === "allocation" ? (
            <AllocationTab
              data={data}
              usageQuery={usageQuery}
              selectedUserIds={allocationSelectedUserIds}
              onUsageQueryChange={(query) => setUsageQuery(query)}
              onSelectedUserIdsChange={setAllocationSelectedUserIds}
            />
          ) : null}
          {tab === "balance" ? <BalanceSettingsTab data={data} onRefresh={() => void loadDashboard()} /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
