import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/context/I18nContext";
import type { TranslationKey } from "@/lib/i18n";
import {
  APPOINTMENT_REMINDERS,
  MIN_REMINDER_DAYS,
  REMINDER_OPTIONS,
  appointmentReminderForDays,
  clampReminderDays,
  normalizeAppointmentReminder,
  parseAppointmentReminderDays,
  type ReminderDays,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

function chipClass(active: boolean): string {
  return cn(
    "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all active:scale-95",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
  );
}

function dayChipLabel(days: number, t: Translate): string {
  return days === 1 ? t("reminders.oneDay") : t("reminders.days", { count: days });
}

/**
 * Numeric "days before" input revealed when the Custom chip is active.
 * 16px font so iOS never zooms; digits only; clamps to 1-365.
 */
function CustomDaysRow({
  days,
  onDays,
  autoFocusOnMount,
}: {
  /** Currently applied (valid) day count. */
  days: number;
  onDays: (days: number) => void;
  autoFocusOnMount: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState<string>(String(clampReminderDays(days, 1)));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocusOnMount) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => window.clearTimeout(id);
  }, [autoFocusOnMount]);

  const commit = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 3);
    setText(digits);
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_REMINDER_DAYS) {
      onDays(clampReminderDays(parsed));
    }
  };

  const handleBlur = () => {
    const parsed = Number.parseInt(text, 10);
    const valid =
      Number.isFinite(parsed) && parsed >= MIN_REMINDER_DAYS
        ? clampReminderDays(parsed)
        : clampReminderDays(days, 1);
    setText(String(valid));
    if (valid !== days) onDays(valid);
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <Input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label={t("reminders.customAria")}
          className="h-10 w-20 shrink-0 rounded-lg bg-card text-center text-base font-bold tabular"
        />
        <span className="text-[13px] font-semibold text-foreground">
          {t("reminders.daysBeforeSuffix")}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{t("reminders.customHint")}</p>
    </div>
  );
}

/**
 * Day-based reminder picker for documents & subscriptions: preset chips
 * (1, 2, 3, 7, 14, 30, 60, 90 days) plus a Custom chip revealing a numeric
 * "days before" input (1-365).
 */
export function ReminderDaysPicker({
  value,
  onChange,
}: {
  value: ReminderDays;
  onChange: (days: ReminderDays) => void;
}) {
  const { t } = useI18n();
  const isPreset = REMINDER_OPTIONS.includes(value);
  // Sticky: once Custom is opened it stays open even if the typed number
  // happens to equal a preset (e.g. typing "30").
  const [customMode, setCustomMode] = useState<boolean>(!isPreset);
  const [focusCustom, setFocusCustom] = useState<boolean>(false);
  const showCustom = customMode || !isPreset;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {REMINDER_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => {
              setCustomMode(false);
              setFocusCustom(false);
              onChange(days);
            }}
            className={chipClass(!showCustom && value === days)}
          >
            {dayChipLabel(days, t)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustomMode(true);
            setFocusCustom(true);
          }}
          className={chipClass(showCustom)}
        >
          {t("reminders.custom")}
        </button>
      </div>
      {showCustom && (
        <CustomDaysRow
          key={focusCustom ? "focused" : "initial"}
          days={value}
          onDays={onChange}
          autoFocusOnMount={focusCustom}
        />
      )}
    </div>
  );
}

/**
 * Appointment reminder picker: time-of-event options (at event time,
 * 1 hour / 3 hours before) plus day-based presets and a Custom day count.
 * Stored values keep the canonical "N day(s) before" string format so
 * existing appointments and AI suggestions remain compatible.
 */
export function AppointmentReminderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (reminder: string) => void;
}) {
  const { t } = useI18n();
  const normalized = normalizeAppointmentReminder(value);
  const isPreset = APPOINTMENT_REMINDERS.includes(normalized);
  const customDays = parseAppointmentReminderDays(normalized);
  const [customMode, setCustomMode] = useState<boolean>(!isPreset);
  const [focusCustom, setFocusCustom] = useState<boolean>(false);
  const showCustom = customMode || !isPreset;

  const optionLabel = (option: string): string => {
    if (option === "At time of event") return t("reminders.atEventTime");
    if (option === "1 hour before") return t("reminders.oneHourBefore");
    if (option === "3 hours before") return t("reminders.threeHoursBefore");
    const days = parseAppointmentReminderDays(option);
    if (days === 1) return t("reminders.oneDayBefore");
    if (days !== null) return t("reminders.daysBefore", { count: days });
    return option;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {APPOINTMENT_REMINDERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setCustomMode(false);
              setFocusCustom(false);
              onChange(option);
            }}
            className={chipClass(!showCustom && normalized === option)}
          >
            {optionLabel(option)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setCustomMode(true);
            setFocusCustom(true);
            // Selecting Custom immediately applies a valid day-based value so
            // the stored reminder always matches what the UI shows.
            onChange(appointmentReminderForDays(customDays ?? 1));
          }}
          className={chipClass(showCustom)}
        >
          {t("reminders.custom")}
        </button>
      </div>
      {showCustom && (
        <CustomDaysRow
          key={focusCustom ? "focused" : "initial"}
          days={customDays ?? 1}
          onDays={(d) => onChange(appointmentReminderForDays(d))}
          autoFocusOnMount={focusCustom}
        />
      )}
    </div>
  );
}
