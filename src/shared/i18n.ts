export const supportedLocales = ['en', 'es', 'fr', 'zh'] as const;
export type SupportedLocale = typeof supportedLocales[number];
export const defaultLocale: SupportedLocale = 'en';

export const localeNames: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français'
};