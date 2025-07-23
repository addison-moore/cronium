"use client";

import dynamic from "next/dynamic";
import { ActionBuilderSkeleton } from "@/components/ui/loading-skeletons";

const ActionBuilder = dynamic(
  () =>
    import("./ActionBuilder").then((mod) => ({ default: mod.ActionBuilder })),
  {
    ssr: false,
    loading: () => <ActionBuilderSkeleton />,
  },
);

export default ActionBuilder;
