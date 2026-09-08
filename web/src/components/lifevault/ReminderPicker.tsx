import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/context/I18nContext";
import type { TranslationKey } from "@/lib/i18n";
import {
  APPOINTMENT_REMINDERS,
  MIN_REMINDER_DAYS,
  REMINDER_OPTIONS,
  REMINDER_UNITS,
  appointmentReminderForCustom,
  appointmentReminderForDays,
  clampReminderDays,
  normalizeAppointmentReminder,
  parseAppointmentReminderDays,
  parseAppointmentReminderMinutes,
  type ReminderDays,
  type ReminderUnit,
} from "@/lib/types";
import { clampReminderValue } from "@/lib/reminder-scheduling";
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

/** Best (value, unit) decomposition of a lead time in minutes. */
function leadToValueUnit(minutes: number): { value: number; unit: ReminderUnit } {
  if (minutes < 60) return { value: minutes, unit: "minutes" };
  if (minutes < 1440) return { value: Math.round((minutes / 60) * 10) / 10, unit: "hours" };
  return { value: Math.round(minutes / 1440), unit: "days" };
}

/**
 * Numeric custom appointment reminder input with a Minutes / Hours / Days
 * unit selector — any lead time, not just whole days.
 */
function CustomAppointmentRow({
  minutes,
  onMinutes,
  autoFocusOnMount,
}: {
  /** Currently applied lead time in minutes. */
  minutes: number;
  onMinutes: (minutes: number) => void;
  autoFocusOnMount: boolean;
}) {
  const { t } = useI18n();
  const initial = leadToValueUnit(minutes);
  const [text, setText] = useState<string>(String(initial.value));
  const [unit, setUnit] = useState<ReminderUnit>(initial.unit);
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
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
    setText(digits);
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      onMinutes(clampReminderValue(parsed, unit));
    }
  };

  const handleBlur = () => {
    const parsed = Number.parseInt(text, 10);
    const valid = Number.isFinite(parsed) && parsed >= 1 ? clampReminderValue(parsed, unit) : clampReminderValue(minutes, unit);
    setText(String(valid));
    onMinutes(clampReminderValue(valid, unit));
  };

  const unitLabel = (u: ReminderUnit): string =>
    u === "minutes" ? t("reminders.unitMinutes") : u === "hours" ? t("reminders.unitHours") : t("reminders.unitDays");

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
        <div className="flex gap-1.5">
          {REMINDER_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => {
                setUnit(u);
                const parsed = Number.parseInt(text, 10);
                onMinutes(clampReminderValue(Number.isFinite(parsed) && parsed >= 1 ? parsed : minutes, u));
              }}
              aria-pressed={unit === u}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all active:scale-95",
                unit === u
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
              )}
            >
              {unitLabel(u)}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{t("reminders.customUnitsHint")}</p>
    </div>
  );
}

/**
 * Appointment reminder picker: at-event-time, minute/hour/day presets,
 * plus a Custom option that accepts ANY number of Minutes, Hours or Days.
 * Stored values keep the canonical "N minutes/hours/days before" string
 * format so existing appointments and AI suggestions remain compatible.
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
  const customMinutes = parseAppointmentReminderMinutes(normalized);
  const [customMode, setCustomMode] = useState<boolean>(!isPreset);
  const [focusCustom, setFocusCustom] = useState<boolean>(false);
  const showCustom = customMode || !isPreset;

  const optionLabel = (option: string): string => {
    switch (option) {
      case "At event time":
        return t("reminders.atEventTime");
      case "5 minutes before":
        return t("reminders.fiveMinutesBefore");
      case "10 minutes before":
        return t("reminders.tenMinutesBefore");
      case "15 minutes before":
        return t("reminders.fifteenMinutesBefore");
      case "30 minutes before":
        return t("reminders.thirtyMinutesBefore");
      case "45 minutes before":
        return t("reminders.fortyFiveMinutesBefore");
      case "1 hour before":
        return t("reminders.oneHourBefore");
      case "2 hours before":
        return t("reminders.twoHoursBefore");
      case "3 hours before":
        return t("reminders.threeHoursBefore");
      case "6 hours before":
        return t("reminders.sixHoursBefore");
      case "12 hours before":
        return t("reminders.twelveHoursBefore");
      default: {
        const days = parseAppointmentReminderDays(option);
        if (days === 1) return t("reminders.oneDayBefore");
        if (days !== null) return t("reminders.daysBefore", { count: days });
        return option;
      }
    }
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
            // Selecting Custom immediately applies a valid lead time so the
            // stored reminder always matches what the UI shows.
            onChange(
              appointmentReminderForCustom(
                clampReminderValue(customMinutes ?? 60, leadToValueUnit(customMinutes ?? 60).unit),
                leadToValueUnit(customMinutes ?? 60).unit,
              ),
            );
          }}
          className={chipClass(showCustom)}
        >
          {t("reminders.custom")}
        </button>
      </div>
      {showCustom && (
        <CustomAppointmentRow
          key={focusCustom ? "focused" : "initial"}
          minutes={customMinutes ?? 60}
          onMinutes={(m) => {
            const { value: v, unit } = leadToValueUnit(m);
            onChange(appointmentReminderForCustom(clampReminderValue(v, unit), unit));
          }}
          autoFocusOnMount={focusCustom}
        />
      )}
    </div>
  );
}

/** Exposed for tests / AI-suggestion flows that need a canonical string. */
export { appointmentReminderForDays };
