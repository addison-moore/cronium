import { LRUCache } from "lru-cache";
import type { ToolType } from "@/shared/schema";

interface PooledConnection {
  toolId: number;
  toolType: ToolType;
  lastUsed: Date;
  useCount: number;
  // Connection-specific data (headers, auth tokens, etc.)
  connectionData: Record<string, any>;
}

interface ConnectionPoolOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  maxAge?: number; // Max age in milliseconds
  updateAgeOnGet?: boolean;
}

/**
 * Connection pool manager for tool integrations
 * Reduces overhead of creating new connections for each action
 */
export class ConnectionPoolManager {
  private static instance: ConnectionPoolManager;
  private pools: Map<ToolType, LRUCache<string, PooledConnection>>;
  private defaultOptions: Required<ConnectionPoolOptions> = {
    maxSize: 100,
    ttl: 1000 * 60 * 30, // 30 minutes
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    updateAgeOnGet: true,
  };

  private constructor() {
    this.pools = new Map();
  }

  static getInstance(): ConnectionPoolManager {
    if (!ConnectionPoolManager.instance) {
      ConnectionPoolManager.instance = new ConnectionPoolManager();
    }
    return ConnectionPoolManager.instance;
  }

  /**
   * Get or create a connection pool for a specific tool type
   */
  private getPool(toolType: ToolType): LRUCache<string, PooledConnection> {
    if (!this.pools.has(toolType)) {
      const pool = new LRUCache<string, PooledConnection>({
        max: this.defaultOptions.maxSize,
        ttl: this.defaultOptions.ttl,
        updateAgeOnGet: this.defaultOptions.updateAgeOnGet,
        dispose: (value, key) => {
          console.log(`Disposing connection ${key} for ${toolType}`);
          // Cleanup logic if needed (close connections, clear tokens, etc.)
        },
      });
      this.pools.set(toolType, pool);
    }
    return this.pools.get(toolType)!;
  }

  /**
   * Get a pooled connection
   */
  getConnection(
    toolId: number,
    toolType: ToolType,
    userId: string,
  ): PooledConnection | undefined {
    const pool = this.getPool(toolType);
    const key = `${toolId}-${userId}`;
    const connection = pool.get(key);

    if (connection) {
      // Update usage stats
      connection.lastUsed = new Date();
      connection.useCount++;
      pool.set(key, connection);
    }

    return connection;
  }

  /**
   * Store a connection in the pool
   */
  setConnection(
    toolId: number,
    toolType: ToolType,
    userId: string,
    connectionData: Record<string, any>,
  ): void {
    const pool = this.getPool(toolType);
    const key = `${toolId}-${userId}`;

    const connection: PooledConnection = {
      toolId,
      toolType,
      lastUsed: new Date(),
      useCount: 1,
      connectionData,
    };

    pool.set(key, connection);
  }

  /**
   * Remove a connection from the pool
   */
  removeConnection(toolId: number, toolType: ToolType, userId: string): void {
    const pool = this.getPool(toolType);
    const key = `${toolId}-${userId}`;
    pool.delete(key);
  }

  /**
   * Clear all connections for a specific tool
   */
  clearToolConnections(toolType: ToolType): void {
    const pool = this.pools.get(toolType);
    if (pool) {
      pool.clear();
    }
  }

  /**
   * Get pool statistics
   */
  getStats(toolType?: ToolType): Record<string, any> {
    if (toolType) {
      const pool = this.pools.get(toolType);
      if (!pool) return { size: 0, connections: [] };

      return {
        size: pool.size,
        maxSize: pool.max,
        connections: Array.from(pool.entries()).map(([key, conn]) => ({
          key,
          toolId: conn.toolId,
          lastUsed: conn.lastUsed,
          useCount: conn.useCount,
        })),
      };
    }

    // Return stats for all pools
    const stats: Record<string, any> = {};
    for (const [type, pool] of this.pools.entries()) {
      stats[type] = {
        size: pool.size,
        maxSize: pool.max,
      };
    }
    return stats;
  }

  /**
   * Prune expired connections
   */
  prune(): void {
    for (const pool of this.pools.values()) {
      pool.purgeStale();
    }
  }
}

// Export singleton instance
export const connectionPool = ConnectionPoolManager.getInstance();

// HTTP client with connection pooling
export class PooledHttpClient {
  private static clients = new Map<string, PooledHttpClient>();

  static getClient(
    baseUrl: string,
    headers?: Record<string, string>,
  ): PooledHttpClient {
    const key = `${baseUrl}-${JSON.stringify(headers || {})}`;

    if (!this.clients.has(key)) {
      this.clients.set(key, new PooledHttpClient(baseUrl, headers));
    }

    return this.clients.get(key)!;
  }

  constructor(
    private baseUrl: string,
    private defaultHeaders?: Record<string, string>,
  ) {}

  async request(
    path: string,
    options: RequestInit & { timeout?: number } = {},
  ): Promise<Response> {
    const { timeout = 30000, ...fetchOptions } = options;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...fetchOptions,
        headers: {
          ...this.defaultHeaders,
          ...fetchOptions.headers,
        },
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
