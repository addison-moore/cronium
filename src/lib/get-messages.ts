import {
  supportedLocales,
  defaultLocale,
  type SupportedLocale,
} from "@shared/i18n";

// Define the type for message structure
interface Messages {
  [key: string]: string | Messages;
}

/**
 * Type guard to check if a locale is supported
 */
function isSupportedLocale(locale: string): locale is SupportedLocale {
  return supportedLocales.includes(locale as SupportedLocale);
}

/**
 * Load messages for the specified locale
 */
export async function getMessages(locale: string): Promise<Messages> {
  // Ensure locale is one of our supported locales
  const safeLocale: SupportedLocale = isSupportedLocale(locale)
    ? locale
    : defaultLocale;

  try {
    // Import the messages for the specified locale
    // Dynamic imports return unknown type, need explicit typing
    const messagesModule: { default: Messages } = (await import(
      `../messages/${safeLocale}.json`
    )) as { default: Messages };
    const messages = messagesModule.default;
    return messages;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${safeLocale}`, error);

    // Fallback to default locale if the requested one fails
    if (safeLocale !== defaultLocale) {
      try {
        const defaultMessagesModule: { default: Messages } = (await import(
          `../messages/${defaultLocale}.json`
        )) as { default: Messages };
        const defaultMessages = defaultMessagesModule.default;
        return defaultMessages;
      } catch (defaultError) {
        console.error(
          `Failed to load default messages for locale: ${defaultLocale}`,
          defaultError,
        );
      }
    }

    // If even default locale fails, return an empty object
    return {};
  }
}
