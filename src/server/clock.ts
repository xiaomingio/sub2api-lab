/*
 * 文件说明: 提供服务端统一的当前时间，开发环境可用固定时间回放历史数据。
 */

export function getCurrentTime(fakeNow?: Date | null): Date {
  return fakeNow ? new Date(fakeNow) : new Date();
}

