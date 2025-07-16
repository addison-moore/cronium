import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface EventSearchProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function EventSearch({ value, onChange, onClear }: EventSearchProps) {
  const t = useTranslations("workflows");

  return (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
      <Input
        placeholder={t("searchEvents")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8 pl-8"
      />
      {value && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="absolute top-1 right-1 h-7 w-7 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
