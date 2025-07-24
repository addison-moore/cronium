export const supportedLocales = ["en", "es"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "en";

export const localeNames: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
};
