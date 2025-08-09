import { Config } from "drizzle-kit";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from the root env/.env.local file
dotenv.config({ path: path.resolve(__dirname, "../../env/.env.local") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

export default {
  schema: "./src/shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
} satisfies Config;
