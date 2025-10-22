"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const EventForm = dynamic(() => import("./EventForm"), {
  ssr: false,
  loading: () => <Skeleton className="h-[600px] w-full" />,
});

export default EventForm;
