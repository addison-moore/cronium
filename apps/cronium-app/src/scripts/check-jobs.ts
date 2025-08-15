#!/usr/bin/env tsx

import { db } from "../server/db";
import { jobs } from "../shared/schema";
import { desc } from "drizzle-orm";

async function checkJobs() {
  const results = await db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(5);
  console.log("Recent jobs:");
  results.forEach((j) =>
    console.log(
      `  - ${j.id}: type=${j.type}, status=${j.status}, orchestratorId=${j.orchestratorId ?? "none"}`,
    ),
  );
  process.exit(0);
}

checkJobs().catch(console.error);
