"use client";

import dynamic from "next/dynamic";
import { FormSkeleton } from "@cronium/ui";

const EventForm = dynamic(() => import("./EventForm"), {
  ssr: false,
  loading: () => <FormSkeleton />,
});

export default EventForm;
