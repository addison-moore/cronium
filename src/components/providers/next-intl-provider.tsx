"use client";

import { NextIntlClientProvider } from "next-intl";
import { type ReactNode } from "react";
import { type SupportedLocale } from "@shared/i18n";

interface NextIntlProviderProps {
  locale: SupportedLocale;
  children: ReactNode;
  messages: Record<string, any>;
}

export function NextIntlProvider({
  locale,
  children,
  messages,
}: NextIntlProviderProps) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      // Maintain state on page transitions
      timeZone="UTC"
    >
      {children}
    </NextIntlClientProvider>
  );
}
