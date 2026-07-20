/*
 * 文件说明: 调用 Sub2API 管理员接口覆盖所选用户余额，并汇总成功、跳过和失败结果。
 * 参考资料: Wei-Shaw/sub2api 管理员用户余额接口。
 */

import type { BalanceAccount } from "./balances.js";
import { systemBalancesMatch } from "./balances.js";

type SetBalanceInput = {
  userId: number;
  targetBalance: string;
  idempotencyKey: string;
  notes: string;
};

type Sub2APIAdminClient = {
  setUserBalance(input: SetBalanceInput): Promise<void>;
};

type RestoreFailure = {
  userId: number;
  displayName: string;
  reason: string;
};

type RestoreBalancesResult = {
  updatedUserIds: number[];
  unchangedUserIds: number[];
  failures: RestoreFailure[];
};

type FetchImplementation = typeof fetch;

function displayName(account: BalanceAccount): string {
  return account.email || account.username || `用户 #${account.userId}`;
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown; reason?: unknown };
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    return [message, reason].filter(Boolean).join("：") || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createSub2APIAdminClient(params: {
  baseUrl: string;
  adminApiKey: string;
  fetchImplementation?: FetchImplementation;
}): Sub2APIAdminClient {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const fetchImplementation = params.fetchImplementation || fetch;
  new URL(baseUrl);

  return {
    async setUserBalance(input): Promise<void> {
      const response = await fetchImplementation(`${baseUrl}/api/v1/admin/users/${input.userId}/balance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "x-api-key": params.adminApiKey
        },
        body: JSON.stringify({
          balance: Number(input.targetBalance),
          operation: "set",
          notes: input.notes
        }),
        signal: AbortSignal.timeout(15_000)
      });

      if (!response.ok) {
        throw new Error(await responseErrorMessage(response));
      }
    }
  };
}

export async function restoreSelectedUserBalances(params: {
  accounts: BalanceAccount[];
  targetBalance: string;
  operationId: string;
  client: Sub2APIAdminClient;
  concurrency?: number;
}): Promise<RestoreBalancesResult> {
  const pendingAccounts = params.accounts.filter(
    (account) => !systemBalancesMatch(account.currentBalance, params.targetBalance)
  );
  const unchangedUserIds = params.accounts
    .filter((account) => systemBalancesMatch(account.currentBalance, params.targetBalance))
    .map((account) => account.userId);
  const updatedUserIds: number[] = [];
  const failures: RestoreFailure[] = [];
  const concurrency = Math.max(1, Math.min(params.concurrency || 4, 8));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < pendingAccounts.length) {
      const account = pendingAccounts[nextIndex];
      nextIndex += 1;
      try {
        await params.client.setUserBalance({
          userId: account.userId,
          targetBalance: params.targetBalance,
          idempotencyKey: `sub2api-lab-${params.operationId}-${account.userId}`,
          notes: `Sub2API Lab 批量恢复系统余额至 $${params.targetBalance}`
        });
        updatedUserIds.push(account.userId);
      } catch (error) {
        failures.push({
          userId: account.userId,
          displayName: displayName(account),
          reason: error instanceof Error ? error.message : "Sub2API 未返回可识别的错误"
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pendingAccounts.length) }, () => worker()));
  updatedUserIds.sort((left, right) => left - right);
  unchangedUserIds.sort((left, right) => left - right);
  failures.sort((left, right) => left.userId - right.userId);
  return { updatedUserIds, unchangedUserIds, failures };
}

export type { RestoreBalancesResult, RestoreFailure, SetBalanceInput, Sub2APIAdminClient };
