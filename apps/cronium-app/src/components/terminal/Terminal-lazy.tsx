"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const Terminal = dynamic(
  () =>
    import("./Terminal").then((mod) => {
      // Import XTerm CSS when the component is loaded
      // @ts-expect-error - CSS import
      void import("@xterm/xterm/css/xterm.css");
      return mod;
    }),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[500px] w-full" />,
  },
);

export default Terminal;
