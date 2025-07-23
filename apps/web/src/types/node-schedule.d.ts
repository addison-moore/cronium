declare module "node-schedule" {
  export type Job = {
    cancel: () => void;
  };

  export class RecurrenceRule {
    second?: number | number[];
    minute?: number | number[];
    hour?: number | number[];
    date?: number | number[];
    month?: number | number[];
    year?: number | number[];
    dayOfWeek?: number | number[];
  }

  export function scheduleJob(
    rule: RecurrenceRule | string | Date,
    callback: () => void,
  ): Job;

  export function gracefulShutdown(): void;
}
