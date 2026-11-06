/**
 * Reading a sensitive system setting.
 *
 * A stored value that can't be decrypted, usually because ENCRYPTION_KEY changed and
 * the value didn't move with it, has no usable value. What's in the row is ciphertext.
 * These reads used to hand that back as the value, so a password reset logged in to
 * the SMTP server with ciphertext as the password, and an AI request sent it to the
 * provider as a key, with a log line as the only sign.
 */
import type { SensitiveSystemSetting } from "@/lib/encryption-service";
import { describeFailure } from "@/lib/pg-errors";
import { decryptSystemSetting } from "@/lib/security/field-secret";

const SETTING_DESCRIPTIONS: Record<
  SensitiveSystemSetting,
  { name: string; effect: string; adminTab: string }
> = {
  smtpPassword: {
    name: "SMTP password",
    effect: "email can't be sent",
    adminTab: "Email Settings",
  },
  openaiApiKey: {
    name: "OpenAI API key",
    effect: "it can't be used",
    adminTab: "AI Assistant",
  },
  anthropicApiKey: {
    name: "Anthropic API key",
    effect: "it can't be used",
    adminTab: "AI Assistant",
  },
  geminiApiKey: {
    name: "Google AI API key",
    effect: "it can't be used",
    adminTab: "AI Assistant",
  },
  customAiApiKey: {
    name: "API key for the custom AI provider",
    effect: "it can't be used",
    adminTab: "AI Assistant",
  },
};

/**
 * The message says what's wrong and where to fix it, and holds nothing from the row or
 * the key, so an authenticated caller can be shown it. Not an anonymous one: it tells
 * them the state of this instance's secrets.
 */
export class UnreadableSettingError extends Error {
  constructor(readonly key: SensitiveSystemSetting) {
    const { name, effect, adminTab } = SETTING_DESCRIPTIONS[key];
    super(
      `The saved ${name} can't be decrypted, so ${effect}. An administrator can enter it again under Administration > ${adminTab}.`,
    );
    this.name = "UnreadableSettingError";
  }
}

/**
 * The value of a sensitive setting, for a stored value that isn't blank.
 *
 * @throws UnreadableSettingError in place of ever returning the stored text. That
 * includes a long plaintext from before settings were encrypted, if it's made of base64
 * characters: nothing tells it apart from ciphertext under a key that's gone, so it has
 * to be entered again too.
 */
export function readSensitiveSetting(
  stored: string,
  key: SensitiveSystemSetting,
): string {
  try {
    return decryptSystemSetting(stored, key);
  } catch (error) {
    console.error(
      `System setting ${key} can't be decrypted: ${describeFailure(error)}. ENCRYPTION_KEY may have changed. Enter the value again in the admin settings, or put the old key back.`,
    );
    throw new UnreadableSettingError(key);
  }
}
