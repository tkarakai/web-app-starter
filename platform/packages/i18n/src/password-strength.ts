import { createTranslator } from "next-intl";
import en from "../messages/en.json";

const translate = createTranslator({ locale: "en", messages: en, namespace: "passwordStrength" });

/** English-only surfaces use the same catalogue as the localized product. */
export function translatePasswordStrength(key: string, params?: Record<string, string | number>): string {
  return translate(key as Parameters<typeof translate>[0], params);
}
