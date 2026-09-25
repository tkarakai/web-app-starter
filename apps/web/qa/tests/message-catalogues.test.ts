import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { locales } from "@repo/i18n/config";

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value]]
      : Object.entries(flatten(value, `${prefix}${key}.`)),
  ));
}

function load(locale: string): Messages {
  return JSON.parse(readFileSync(new URL(`../../../../packages/i18n/messages/${locale}.json`, import.meta.url), "utf8")) as Messages;
}

function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  function visit(elements: MessageFormatElement[]): void {
    for (const element of elements) {
      if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
      if (element.type === TYPE.tag) {
        visit(element.children);
        continue;
      }
      names.add(element.value);
      if (element.type === TYPE.select || element.type === TYPE.plural) {
        for (const option of Object.values(element.options)) visit(option.value);
      }
    }
  }
  visit(parse(message));
  return [...names].sort();
}

describe("locale message contract", () => {
  const baseline = flatten(load("en"));

  for (const locale of locales) {
    it(`${locale} supplies every required key and preserves interpolation parameters`, () => {
      const messages = load(locale);
      const flat = flatten(messages);
      const translate = createTranslator({ locale, messages, onError: (error) => { throw error; } });
      // Application-specific extra keys are supported; required keys must remain.
      for (const [key, source] of Object.entries(baseline)) {
        expect(flat[key], `${locale}:${key}`).toBeDefined();
        const args = argumentsOf(source);
        expect(argumentsOf(flat[key]), `${locale}:${key}`).toEqual(args);
        expect(translate(key, Object.fromEntries(args.map((arg) => [arg, 2])))).toBeTruthy();
      }
    });
  }
});
