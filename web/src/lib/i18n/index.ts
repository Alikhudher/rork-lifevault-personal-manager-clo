import { ar as arDateLocale } from "date-fns/locale";
import { en } from "./locales/en";
import { ar } from "./locales/ar";
import type { TranslationDict } from "./locales/en";

export type { TranslationDict } from "./locales/en";

/** Derived from a real locale object so it works across date-fns versions. */
type DateLocale = typeof arDateLocale;

/** Every dot-separated path that resolves to a string in the dictionary. */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = DotPaths<TranslationDict>;

export type LanguageCode = "en" | "ar";

export interface LanguageInfo {
  code: LanguageCode;
  /** Name shown in the selector, written in the language itself. */
  nativeName: string;
  /** English reference name. */
  englishName: string;
  dir: "ltr" | "rtl";
}

/**
 * Language registry — the single place a new language is registered.
 * The Settings selector, RTL handling and date-fns localisation all read
 * from here, so adding a language never requires touching screen code.
 */
export const LANGUAGES: LanguageInfo[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
];

const DICTS: Record<LanguageCode, TranslationDict> = { en, ar };

/** date-fns locales per language (undefined = date-fns default English). */
const DATE_LOCALES: Partial<Record<LanguageCode, DateLocale>> = {
  ar: arDateLocale,
};

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

export function languageInfo(code: LanguageCode): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function getDateLocale(code: LanguageCode): DateLocale | undefined {
  return DATE_LOCALES[code];
}

function lookup(dict: TranslationDict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node !== null && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Resolve a key in the given language with `{placeholder}` interpolation.
 * Falls back to English, then to the key itself, so a missing translation
 * can never crash or blank out the UI.
 */
export function translate(
  language: LanguageCode,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const raw = lookup(DICTS[language], key) ?? lookup(DICTS.en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
