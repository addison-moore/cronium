"use client";

import React from "react";
import { useParams } from "next/navigation";
import { EventDetails } from "@/components/event-details/EventDetails";

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const routeParams = useParams<{ lang: string }>();
  const langParam = routeParams.lang;

  const eventId = React.use(params).id;

  return <EventDetails eventId={eventId} langParam={langParam} />;
}
