import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ locale }) => {
  // Ensure locale has a fallback value
  const validLocale = locale ?? "en";

  try {
    return {
      locale: validLocale,
      messages: (await import(`../messages/${validLocale}.json`)).default,
    };
  } catch (error) {
    // Fallback to English if the locale file doesn't exist
    return {
      locale: "en",
      messages: (await import(`../messages/en.json`)).default,
    };
  }
});
