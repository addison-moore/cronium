import { db } from "@/server/db";
import { logs } from "@/shared/schema";

void (async function deleteAllLogs() {
  console.log("Deleting all logs ...");
  try {
    const result = await db.delete(logs);

    console.log(`Deleted ${result.rowCount ?? 0} log entries.`);
  } catch (error) {
    console.error("Error deleting logs:", error);
  }
})();
