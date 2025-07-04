/**
 * Type declarations for modules without built-in TypeScript support
 */

declare module "archiver" {
  import type { Stream } from "stream";

  interface ArchiverOptions {
    zlib?: any;
    store?: boolean;
  }

  interface ArchiverEntry {
    name: string;
    data: string | Buffer | Stream;
    mode?: number;
  }

  interface Archiver extends Stream.Transform {
    append(
      source: string | Buffer | Stream,
      data?: Partial<ArchiverEntry>,
    ): Archiver;
    directory(dirpath: string, destpath?: string | false): Archiver;
    file(filename: string, data?: Partial<ArchiverEntry>): Archiver;
    glob(pattern: string, options?: any): Archiver;
    finalize(): Promise<void>;
    on(event: "error", callback: (err: Error) => void): this;
    on(event: "warning", callback: (err: Error) => void): this;
    on(event: "end", callback: () => void): this;
    on(event: "close", callback: () => void): this;
    on(event: string, callback: (...args: any[]) => void): this;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
  }

  function create(type: "zip" | "tar", options?: ArchiverOptions): Archiver;
  export = create;
}

declare module "prismjs/themes/prism-tomorrow.css";
declare module "prismjs/components/prism-python";
declare module "prismjs/components/prism-javascript";
declare module "prismjs/components/prism-bash";
declare module "prismjs/components/prism-json";
