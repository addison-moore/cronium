"use client";

import { useTranslations, useLocale } from "next-intl";
import { Plus, MoreVertical } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import EventsList from "@/components/dashboard/EventsList";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JsonImportModal } from "@/components/dashboard/JsonImportModal";
import { useState } from "react";

export default function EventsPage() {
  const t = useTranslations("Events");
  const locale = useLocale();
  const [isJsonImportOpen, setIsJsonImportOpen] = useState(false);

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild className="border-none">
        <Button variant="outline" size="icon">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-secondary-bg">
        <DropdownMenuItem onClick={() => setIsJsonImportOpen(true)}>
          Add event from JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="container mx-auto p-4">
      <PageHeader
        title={t("Title")}
        description={t("Description")}
        createButton={{
          href: `/${locale}/dashboard/events/new`,
          label: t("NewEvent"),
          icon: <Plus className="h-4 w-4" />,
        }}
        actions={actions}
      />
      <EventsList />
      <JsonImportModal
        isOpen={isJsonImportOpen}
        onClose={() => setIsJsonImportOpen(false)}
      />
    </div>
  );
}
