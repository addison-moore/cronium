"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const Terminal = dynamic(
  () =>
    import("./Terminal").then((mod) => {
      // Import XTerm CSS when the component is loaded. (Next 16 types CSS
      // side-effect imports, so this no longer needs a @ts-expect-error.)
      void import("@xterm/xterm/css/xterm.css");
      return mod;
    }),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[500px] w-full" />,
  },
);

export default Terminal;
