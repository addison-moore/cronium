#!/usr/bin/env tsx

import { db } from "@/server/db";
import { events } from "@/shared/schema";
import { eq } from "drizzle-orm";

async function getEventInfo() {
  const [event] = await db.select().from(events).where(eq(events.id, 557));
  if (event) {
    console.log("Event ID:", event.id);
    console.log("Event name:", event.name);
    console.log("User ID:", event.userId);
  } else {
    console.log("Event not found");
  }
}

getEventInfo()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
