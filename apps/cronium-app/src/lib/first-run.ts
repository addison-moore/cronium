import { db } from "@/server/db";
import { users } from "@/shared/schema";

/**
 * True while the instance has no users at all — i.e. a fresh install that
 * still needs its first admin account created via /auth/setup (or seeded
 * headlessly with AUTO_SEED_ADMIN).
 */
export async function isSetupRequired(): Promise<boolean> {
  const anyUser = await db.select({ id: users.id }).from(users).limit(1);
  return anyUser.length === 0;
}
