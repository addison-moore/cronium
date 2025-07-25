import { supportedLocales, defaultLocale } from "@/shared/i18n";
import type { SupportedLocale } from "@/shared/i18n";
import { redirect } from "next/navigation";
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { type Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "../styles/global.css";

// Define a type for the translation messages
interface TranslationMessages {
  [key: string]:
    | string
    | TranslationMessages
    | Array<string | TranslationMessages>;
}

export const metadata: Metadata = {
  title: "Cronium - Self-Hosted Automation Platform",
  description:
    "Open-source automation platform designed for developers and teams who need reliable, flexible task scheduling and workflow automation.",
};

export async function generateStaticParams() {
  return supportedLocales.map((lang: SupportedLocale) => ({ lang }));
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
    <html lang={lang} className="h-full">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Apply dark mode based on system preference
              try {
                if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="h-full bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <ThemeProvider>
          <NextIntlClientProvider
            locale={lang as SupportedLocale}
            messages={messages}
          >
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
