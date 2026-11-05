import type { Log } from "@shared/schema";

/** The shape of GET /api/logs, as consumed by the log tables. */
export interface LogsResponse {
  logs: Log[];
  items: Log[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}
