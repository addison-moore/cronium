import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    AUTH_SECRET: z.string(),
    AUTH_URL: z.string().url(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM_EMAIL: z.string().optional(),
    DATABASE_URL: z.string(),
    OPENAI_API_KEY: z.string().optional(),
    PUBLIC_APP_URL: z.string().url().optional(),
    ENCRYPTION_KEY: z.string(),
    ORCHESTRATOR_URL: z
      .string()
      .url()
      .optional()
      .default("http://orchestrator:8080"),
    VALKEY_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
  },
  client: {
    PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL,
    VALKEY_URL: process.env.VALKEY_URL,
    REDIS_URL: process.env.REDIS_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
