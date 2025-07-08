"use client";

import { useTranslations } from "next-intl";
import { ToolActionTemplateManager } from "@/components/tools/templates/ToolActionTemplateManager";

export default function ToolTemplatesPage() {
  const t = useTranslations();

  return (
    <div className="container mx-auto space-y-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tool Action Templates</h1>
          <p className="text-muted-foreground">
            Create and manage reusable templates for tool actions
          </p>
        </div>
      </div>

      {/* Template Manager Component */}
      <ToolActionTemplateManager />
    </div>
  );
}
