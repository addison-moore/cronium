type Messages = Record<string, unknown>;

export async function getMessages(locale: string): Promise<Messages> {
  try {
    const messages = (
      (await import(`../messages/${locale}.json`)) as { default: Messages }
    ).default;
    return messages;
  } catch (error) {
    console.error(`Failed to load messages for locale ${locale}`, error);
    // Fallback to English
    const messages = (
      (await import(`../messages/en.json`)) as { default: Messages }
    ).default;
    return messages;
  }
}
