import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { format, isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { useApp } from "@/context/AppContext";
import { daysUntil } from "@/lib/format";
import {
  DEFAULT_LANGUAGE,
  getDateLocale,
  isLanguageCode,
  languageInfo,
  translate,
  type LanguageCode,
  type TranslationKey,
} from "@/lib/i18n";

interface I18nContextValue {
  /** Active language code (persisted in settings, synced to the cloud). */
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  /** Translate a key with optional `{placeholder}` interpolation. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  dir: "ltr" | "rtl";
  isRTL: boolean;
  /** date-fns `format` in the active language (e.g. month names in Arabic). */
  fmtDate: (iso: string, pattern: string) => string;
  /** Localised "Today / Tomorrow / Yesterday / Fri, 12 Mar" label. */
  relativeDay: (iso: string) => string;
  /** Localised "today / tomorrow / in 5 days / 3 days ago" fragment. */
  dueIn: (iso: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * App-wide localisation provider. The chosen language lives in
 * `settings.language`, so it persists locally and rides the existing
 * encrypted cloud sync like every other preference. Must be mounted inside
 * `AppProvider`.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useApp();

  const language: LanguageCode = isLanguageCode(settings.language)
    ? settings.language
    : DEFAULT_LANGUAGE;
  const dir = languageInfo(language).dir;

  // Keep <html lang> and <html dir> in sync so the whole document flips to
  // right-to-left for Arabic (flex layouts, text alignment, scroll anchoring).
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      updateSettings({ language: code });
    },
    [updateSettings],
  );

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language],
  );

  const fmtDate = useCallback(
    (iso: string, pattern: string) =>
      format(parseISO(iso), pattern, { locale: getDateLocale(language) }),
    [language],
  );

  const relativeDay = useCallback(
    (iso: string) => {
      const d = parseISO(iso);
      if (isToday(d)) return translate(language, "common.relToday");
      if (isTomorrow(d)) return translate(language, "common.relTomorrow");
      if (isYesterday(d)) return translate(language, "common.relYesterday");
      return format(d, "EEE, d MMM", { locale: getDateLocale(language) });
    },
    [language],
  );

  const dueIn = useCallback(
    (iso: string) => {
      const days = daysUntil(iso);
      if (days === 0) return translate(language, "common.dueToday");
      if (days === 1) return translate(language, "common.dueTomorrow");
      if (days === -1) return translate(language, "common.dueYesterday");
      if (days > 1) return translate(language, "common.dueInDays", { count: days });
      return translate(language, "common.dueDaysAgo", { count: Math.abs(days) });
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t,
      dir,
      isRTL: dir === "rtl",
      fmtDate,
      relativeDay,
      dueIn,
    }),
    [language, setLanguage, t, dir, fmtDate, relativeDay, dueIn],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
