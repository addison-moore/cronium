import { supportedLocales, defaultLocale } from "@shared/i18n";

/**
 * Load messages for the specified locale
 */
export async function getMessages(locale: string) {
  // Ensure locale is one of our supported locales
  const safeLocale = supportedLocales.includes(locale as any)
    ? locale
    : defaultLocale;

  try {
    // Import the messages for the specified locale
    const messages = (await import(`../messages/${safeLocale}.json`)).default;
    return messages;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${safeLocale}`, error);

    // Fallback to default locale if the requested one fails
    if (safeLocale !== defaultLocale) {
      const defaultMessages = (
        await import(`../messages/${defaultLocale}.json`)
      ).default;
      return defaultMessages;
    }

    // If even default locale fails, return an empty object
    return {};
  }
}
