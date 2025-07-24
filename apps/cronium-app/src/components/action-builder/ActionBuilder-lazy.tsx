"use client";

import dynamic from "next/dynamic";
import { ActionBuilderSkeleton } from "@cronium/ui";

const ActionBuilder = dynamic(
  () =>
    import("./ActionBuilder").then((mod) => ({ default: mod.ActionBuilder })),
  {
    ssr: false,
    loading: () => <ActionBuilderSkeleton />,
  },
);

export default ActionBuilder;
