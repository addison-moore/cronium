// Storage extensions for new job-based architecture
import { db } from "@/server/db";
import { logs } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function getLogsByJobId(jobId: string) {
  return db.select().from(logs).where(eq(logs.jobId, jobId));
}

export async function getLog(logId: number) {
  const [log] = await db.select().from(logs).where(eq(logs.id, logId)).limit(1);
  return log ?? null;
}

export async function updateLog(
  logId: number,
  updates: Partial<typeof logs.$inferInsert>,
) {
  const [updated] = await db
    .update(logs)
    .set(updates)
    .where(eq(logs.id, logId))
    .returning();
  return updated;
}
