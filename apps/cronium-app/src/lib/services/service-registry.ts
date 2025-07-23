import { readFileSync } from "fs";
import { join } from "path";

export interface ServiceEndpoint {
  host: string;
  port: number;
  protocol: string;
  endpoints?: Record<string, string>;
  healthCheck?: {
    type: string;
    path?: string;
    interval: number;
    timeout: number;
  };
}

export interface ServiceConfig {
  services: Record<string, ServiceEndpoint>;
  networks: Record<
    string,
    {
      name: string;
      subnet: string;
      driver: string;
    }
  >;
  discovery: {
    method: string;
    cache: {
      ttl: number;
      negative_ttl: number;
    };
  };
}

class ServiceRegistry {
  private config: ServiceConfig;
  private cache = new Map<string, { url: string; timestamp: number }>();

  constructor() {
    // Load configuration based on environment
    const configPath =
      process.env.SERVICE_DISCOVERY_CONFIG ??
      join(process.cwd(), "configs", "service-discovery.json");

    try {
      const configData = readFileSync(configPath, "utf8");
      this.config = JSON.parse(configData) as ServiceConfig;
    } catch {
      console.warn(
        "Service discovery config not found, using environment variables",
      );
      this.config = this.buildConfigFromEnv();
    }
  }

  private buildConfigFromEnv(): ServiceConfig {
    return {
      services: {
        "runtime-api": {
          host: new URL(
            process.env.RUNTIME_API_URL ?? "http://runtime-api:8081",
          ).hostname,
          port: parseInt(
            new URL(process.env.RUNTIME_API_URL ?? "http://runtime-api:8081")
              .port ?? "8081",
          ),
          protocol: "http",
          endpoints: {
            base: process.env.RUNTIME_API_URL ?? "http://runtime-api:8081",
            health: "/health",
            metrics: "/metrics",
          },
        },
        orchestrator: {
          host: new URL(
            process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8080",
          ).hostname,
          port: parseInt(
            new URL(process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8080")
              .port ?? "8080",
          ),
          protocol: "http",
          endpoints: {
            base: process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8080",
            health: "/health",
            metrics: "/metrics",
          },
        },
        postgres: {
          host: "postgres",
          port: 5432,
          protocol: "postgresql",
        },
        valkey: {
          host: "valkey",
          port: 6379,
          protocol: "redis",
        },
      },
      networks: {
        internal: {
          name: "cronium-network",
          subnet: "172.20.0.0/16",
          driver: "bridge",
        },
      },
      discovery: {
        method: "dns",
        cache: {
          ttl: 60,
          negative_ttl: 10,
        },
      },
    };
  }

  getServiceUrl(serviceName: string, endpoint?: string): string {
    const cacheKey = `${serviceName}:${endpoint ?? "base"}`;
    const cached = this.cache.get(cacheKey);

    if (
      cached &&
      Date.now() - cached.timestamp < this.config.discovery.cache.ttl * 1000
    ) {
      return cached.url;
    }

    const service = this.config.services[serviceName];
    if (!service) {
      throw new Error(`Service ${serviceName} not found in registry`);
    }

    let url: string;
    if (endpoint && service.endpoints?.[endpoint]) {
      url = service.endpoints[endpoint];
    } else if (service.endpoints?.base) {
      url = service.endpoints.base;
    } else {
      url = `${service.protocol}://${service.host}:${service.port}`;
    }

    this.cache.set(cacheKey, { url, timestamp: Date.now() });
    return url;
  }

  getService(serviceName: string): ServiceEndpoint | undefined {
    return this.config.services[serviceName];
  }

  getAllServices(): Record<string, ServiceEndpoint> {
    return this.config.services;
  }

  getHealthCheckConfig(serviceName: string) {
    const service = this.config.services[serviceName];
    return service?.healthCheck;
  }

  async checkServiceHealth(serviceName: string): Promise<boolean> {
    const service = this.config.services[serviceName];
    if (!service?.healthCheck) {
      return false;
    }

    const healthCheck = service.healthCheck;

    try {
      if (healthCheck.type === "http" && healthCheck.path) {
        const healthUrl =
          this.getServiceUrl(serviceName, "health") ??
          `${this.getServiceUrl(serviceName)}${healthCheck.path}`;

        const response = await fetch(healthUrl, {
          method: "GET",
          signal: AbortSignal.timeout(healthCheck.timeout * 1000),
        });

        return response.ok;
      } else if (healthCheck.type === "tcp") {
        // TCP health check would require a different approach
        // For now, we'll assume it's healthy if we can resolve the service
        return true;
      }
    } catch (error) {
      console.error(`Health check failed for ${serviceName}:`, error);
      return false;
    }

    return false;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const serviceRegistry = new ServiceRegistry();

// Export convenience functions
export function getServiceUrl(serviceName: string, endpoint?: string): string {
  return serviceRegistry.getServiceUrl(serviceName, endpoint);
}

export function getService(serviceName: string): ServiceEndpoint | undefined {
  return serviceRegistry.getService(serviceName);
}

export async function checkServiceHealth(
  serviceName: string,
): Promise<boolean> {
  return serviceRegistry.checkServiceHealth(serviceName);
}
