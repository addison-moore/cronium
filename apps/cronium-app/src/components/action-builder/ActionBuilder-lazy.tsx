"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const ActionBuilder = dynamic(
  () =>
    import("./ActionBuilder").then((mod) => ({ default: mod.ActionBuilder })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
);

export default ActionBuilder;
