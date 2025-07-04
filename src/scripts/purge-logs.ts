import { db } from '@/server/db';
import { logs } from '@/shared/schema';

(async function deleteAllLogs() {

      console.log('Deleting all logs ...');
    try {
        const result = await db.delete(logs)
   
        console.log(`Deleted ${result.rowCount} log entries.`);

    } catch (error) {
        console.error('Error deleting logs:', error);
    } 
})();