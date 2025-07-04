"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { supportedLocales, localeNames, SupportedLocale } from "@shared/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

export default function LanguageSelector() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale } = useLanguage();

  // Get the path without the locale prefix
  const pathWithoutLocale = pathname.replace(/^\/[^\/]+/, "") || "/";

  const handleLocaleChange = (newLocale: SupportedLocale) => {
    startTransition(() => {
      setLocale(newLocale);
      router.push(`/${newLocale}${pathWithoutLocale}`);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0 hover-theme-button"
          disabled={isPending}
        >
          <Globe className="h-5 w-5" />
          <span className="sr-only">Select language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="bg-popover">
        {supportedLocales.map((localeOption: SupportedLocale) => (
          <DropdownMenuItem
            key={localeOption}
            onClick={() => handleLocaleChange(localeOption)}
            className={localeOption === locale ? "bg-muted font-semibold" : ""}
          >
            {localeNames[localeOption]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
