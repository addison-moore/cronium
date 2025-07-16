import React from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

interface EmptyCanvasPromptProps {
  hasNoEvents?: boolean;
}

export function EmptyCanvasPrompt({
  hasNoEvents = false,
}: EmptyCanvasPromptProps) {
  const t = useTranslations("workflows");

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <Info className="text-muted-foreground/30 h-12 w-12" />
        </div>
        <h3 className="text-muted-foreground/50 text-lg font-semibold">
          {hasNoEvents ? t("noEventsAvailable") : t("emptyCanvas")}
        </h3>
        <p className="text-muted-foreground/40 mt-2 text-sm">
          {hasNoEvents ? t("createEventsFirst") : t("dragEventsToCanvas")}
        </p>
      </div>
    </div>
  );
}
