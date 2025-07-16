"use client";

import dynamic from "next/dynamic";
import { FormSkeleton } from "@/components/ui/loading-skeletons";

const EventForm = dynamic(() => import("./EventForm"), {
  ssr: false,
  loading: () => <FormSkeleton />,
});

export default EventForm;
