import { supportedLocales, defaultLocale } from "@shared/i18n";
import type { SupportedLocale } from "@shared/i18n";
import { redirect } from "next/navigation";
import React from "react";
import { Providers } from "@/components/providers/Providers";
import { Toaster } from "@/components/ui/toaster";
import "../styles/global.css";
import { NextIntlProvider } from "@/components/providers/next-intl-provider";

export async function generateStaticParams() {
  return supportedLocales.map((lang) => ({ lang }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { lang: string };
}) {
  const { lang } = await Promise.resolve(params);

  // Validate that the lang parameter is a supported locale
  if (!supportedLocales.includes(lang as SupportedLocale)) {
    // If not, redirect to the default locale (English)
    redirect(`/${defaultLocale}`);
  }

  // Load messages for the current locale
  let messages;
  try {
    messages = (await import(`../../messages/${lang}.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale ${lang}`, error);
    // Fallback to English if translation file is missing
    messages = (await import(`../../messages/en.json`)).default;
  }

  return (
    <div lang={lang}>
      <NextIntlProvider locale={lang as SupportedLocale} messages={messages}>
        <Providers>
          <main className="min-h-screen">{children}</main>
          <Toaster />
        </Providers>
      </NextIntlProvider>
    </div>
  );
}
