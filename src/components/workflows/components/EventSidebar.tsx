import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslations } from "next-intl";
import { EventSearch } from "./EventSearch";
import { EventList } from "./EventList";
import type { EventType } from "@/shared/schema";

interface Event {
  id: number;
  name: string;
  type: EventType;
  description?: string | null;
}

interface EventSidebarProps {
  availableEvents: Event[];
  isLoading: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onDragStart: (event: React.DragEvent, eventData: Event) => void;
  updateEvents: () => void;
}

export function EventSidebar({
  availableEvents,
  isLoading,
  sidebarOpen,
  setSidebarOpen,
  onDragStart,
  updateEvents,
}: EventSidebarProps) {
  const t = useTranslations("workflows");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEvents = searchQuery
    ? availableEvents.filter(
        (event) =>
          event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          event.type.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : availableEvents;

  return (
    <div className="relative h-full">
      {/* Toggle Button */}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`absolute top-4 z-10 h-8 w-8 rounded-full p-0 transition-all ${
          sidebarOpen ? "right-4" : "-right-10"
        }`}
      >
        {sidebarOpen ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Sidebar Content */}
      <div
        className={`bg-background/95 absolute top-0 right-0 h-full backdrop-blur transition-all ${
          sidebarOpen ? "w-80" : "w-0 overflow-hidden"
        }`}
      >
        <div className="flex h-full flex-col border-l p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">{t("availableEvents")}</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                (window.location.href = "/dashboard/events?create=true")
              }
              className="h-8"
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("newEvent")}
            </Button>
          </div>

          <div className="mb-4">
            <EventSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
            />
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="bg-muted h-16 animate-pulse rounded-lg"
                  />
                ))}
              </div>
            ) : (
              <EventList
                events={filteredEvents}
                onDragStart={onDragStart}
                updateEvents={updateEvents}
              />
            )}
          </ScrollArea>

          <div className="bg-muted/50 text-muted-foreground mt-4 rounded-lg p-3 text-xs">
            <p className="font-medium">{t("tip")}:</p>
            <p>{t("dragToConnect")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
