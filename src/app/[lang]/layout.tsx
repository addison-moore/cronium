import { supportedLocales, defaultLocale } from "@shared/i18n";
import type { SupportedLocale } from "@shared/i18n";
import { redirect } from "next/navigation";
import React from "react";
import { Providers } from "@/components/providers/Providers";
import { Toaster } from "@/components/ui/toaster";
import "../styles/global.css";
import { NextIntlProvider } from "@/components/providers/next-intl-provider";

// Define a type for the translation messages
interface TranslationMessages {
  [key: string]:
    | string
    | TranslationMessages
    | Array<string | TranslationMessages>;
}

export async function generateStaticParams() {
  return supportedLocales.map((lang) => ({ lang }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  // Validate that the lang parameter is a supported locale
  if (!supportedLocales.includes(lang as SupportedLocale)) {
    // If not, redirect to the default locale (English)
    redirect(`/${defaultLocale}`);
  }

  // Load messages for the current locale
  let messages: TranslationMessages;
  try {
    // Explicitly type the dynamic import result
    type MessageModule = { default: TranslationMessages };
    const importedModule = (await import(
      `../../messages/${lang}.json`
    )) as MessageModule;
    messages = importedModule.default;
  } catch (error) {
    console.error(`Failed to load messages for locale ${lang}`, error);
    // Fallback to English if translation file is missing
    const fallbackModule = (await import(`../../messages/en.json`)) as {
      default: TranslationMessages;
    };
    messages = fallbackModule.default;
  }

  return (
    <div lang={lang}>
      <NextIntlProvider locale={lang as SupportedLocale} messages={messages}>
        <React.Suspense fallback={null}>
          <Providers>
            <main className="min-h-screen">{children}</main>
            <Toaster />
          </Providers>
        </React.Suspense>
      </NextIntlProvider>
    </div>
  );
}
