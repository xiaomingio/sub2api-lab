/*
 * 文件说明: 管理台应用壳，负责 Tab 导航、全局查询状态和页面级数据加载。
 */

import { useEffect, useRef, useState } from "react";
import { fetchDashboard, fetchUsageAnalysis, fetchUsageRecordFilterOptions, fetchUsageRecords } from "./api.js";
import { AllocationTab } from "./features/AllocationTab.js";
import { BalanceSettingsTab } from "./features/BalanceSettingsTab.js";
import { RecordsTab } from "./features/RecordsTab.js";
import { UsageTab } from "./features/UsageTab.js";
import { QuotaAnalysisTab } from "./features/QuotaAnalysisTab.js";
import { LoadingSection } from "./components/LoadingSection.js";
import type { UsageAnalysisData } from "./types.js";
import {
  allocationSelectionKey,
  defaultAllocationSelectedUserIds,
  defaultRangePresets,
  initialTab,
  initialUsageQuery,
  tabLabels,
  updateUrl
} from "./features/shared.js";
import type { DashboardData, DashboardTab, UsageQuery, UsageRecordsData, UsageRecordFilterOptions } from "./types.js";

export function App() {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [usageQuery, setUsageQuery] = useState<UsageQuery>(() => initialUsageQuery(defaultRangePresets.usage, initialTab() !== "records"));
  const [recordsQuery, setRecordsQuery] = useState<UsageQuery>(() => initialUsageQuery(defaultRangePresets.records, initialTab() === "records"));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<UsageRecordsData | null>(null);
  const [recordFilterOptions, setRecordFilterOptions] = useState<UsageRecordFilterOptions | null>(null);
  const [recordsLimit, setRecordsLimit] = useState(100);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordAnalysis, setRecordAnalysis] = useState<UsageAnalysisData | null>(null);
  const quotaAnalysisCache = useRef(new Map<string, UsageAnalysisData>()).current;
  const [allocationSelectedUserIds, setAllocationSelectedUserIds] = useState<Set<number>>(new Set());
  const allocationInitialized = useRef(false);
  const allocationSelectionKeyRef = useRef("");
  const activeQuery = tab === "records" ? recordsQuery : usageQuery;

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchDashboard(activeQuery);
      setData(payload);
      const nextAllocationSelectionKey = allocationSelectionKey(activeQuery);
      if (!allocationInitialized.current || allocationSelectionKeyRef.current !== nextAllocationSelectionKey) {
        setAllocationSelectedUserIds(defaultAllocationSelectedUserIds(payload, activeQuery.allocationBasis));
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
    updateUrl(tab, activeQuery);
  }, [activeQuery, tab]);

  useEffect(() => {
    void loadDashboard();
  }, [activeQuery, tab]);

  useEffect(() => {
    if (tab !== "records") return;
    setRecordsPage(1);
  }, [recordsQuery, tab]);

  useEffect(() => {
    if (tab !== "records") return;
    setRecordFilterOptions(null);
    void fetchUsageRecordFilterOptions(recordsQuery)
      .then(setRecordFilterOptions)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "加载筛选选项失败。"));
  }, [recordsQuery, tab]);

  useEffect(() => {
    if (tab !== "records") return;
    setRecordsLoading(true);
    void fetchUsageRecords(recordsQuery, recordsLimit, recordsPage)
      .then(setRecords)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "加载使用记录失败。"))
      .finally(() => setRecordsLoading(false));
  }, [recordsLimit, recordsPage, tab, recordsQuery]);

  useEffect(() => {
    if (tab !== "records") return;
    void fetchUsageAnalysis(recordsQuery, "day", true).then(setRecordAnalysis).catch(() => setRecordAnalysis(null));
  }, [tab, recordsQuery]);

  return (
    <>
      <header className="app-header">
        <div className="app-brand">
          <span className="app-eyebrow">SUB2API LAB / ADMIN</span>
        </div>
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
        <form className="tab-nav-logout" method="post" action="logout">
          <button className="logout-button" type="submit">
            退出
          </button>
        </form>
      </header>

      <main className="page-content">
        {loading && !data ? <LoadingSection /> : null}
        {error ? <div className="status-message is-error">{error}</div> : null}
        {data ? (
          <>
          {tab === "usage" ? (
            <UsageTab data={data} usageQuery={usageQuery} onUsageQueryChange={(query) => setUsageQuery(query)} />
          ) : null}
          {tab === "records" ? (
            <RecordsTab
              data={data}
              usageQuery={recordsQuery}
              records={records}
              filterOptions={recordFilterOptions}
              limit={recordsLimit}
              loading={recordsLoading}
              onLimitChange={setRecordsLimit}
              page={recordsPage}
              onPageChange={setRecordsPage}
              onUsageQueryChange={setRecordsQuery}
              analysis={recordAnalysis}
            />
          ) : null}
          {tab === "quota" ? <QuotaAnalysisTab data={data} analysisCache={quotaAnalysisCache} /> : null}
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
      </main>
    </>
  );
}
