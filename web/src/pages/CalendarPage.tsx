import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarX2, ChevronLeft, ChevronRight, Clock, List, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/lifevault/PageHeader";
import { ChipPicker, Field, FormSheet } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";
import { daysUntil, formatTime12, relativeDayLabel } from "@/lib/format";
import { APPOINTMENT_REMINDERS, type Appointment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AptFormState {
  title: string;
  date: string;
  time: string;
  location: string;
  notes: string;
  reminder: string;
}

function emptyForm(date?: Date): AptFormState {
  return {
    title: "",
    date: format(date ?? new Date(), "yyyy-MM-dd"),
    time: "09:00",
    location: "",
    notes: "",
    reminder: "1 day before",
  };
}

export default function CalendarPage() {
  const { appointments, addAppointment, updateAppointment, deleteAppointment } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"list" | "month">("list");
  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AptFormState>(emptyForm());

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditingId(null);
      setForm(emptyForm());
      setSheetOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
    [appointments],
  );
  const upcoming = useMemo(() => sorted.filter((a) => daysUntil(a.date) >= 0), [sorted]);
  const past = useMemo(() => sorted.filter((a) => daysUntil(a.date) < 0).reverse(), [sorted]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const dayAppointments = useMemo(
    () => sorted.filter((a) => isSameDay(parseISO(a.date), selectedDay)),
    [sorted, selectedDay],
  );

  const openEdit = (apt: Appointment) => {
    setEditingId(apt.id);
    setForm({
      title: apt.title,
      date: apt.date,
      time: apt.time,
      location: apt.location,
      notes: apt.notes,
      reminder: apt.reminder,
    });
    setSheetOpen(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) {
      toast.error("Enter an appointment title");
      return;
    }
    if (!form.date) {
      toast.error("Pick a date");
      return;
    }
    const payload = {
      title: form.title.trim(),
      date: form.date,
      time: form.time || "09:00",
      location: form.location.trim(),
      notes: form.notes.trim(),
      reminder: form.reminder,
    };
    if (editingId) {
      updateAppointment(editingId, payload);
      toast.success("Appointment updated");
    } else {
      addAppointment(payload);
      toast.success("Appointment added");
    }
    setSheetOpen(false);
  };

  const AppointmentRow = ({ apt }: { apt: Appointment }) => (
    <button
      onClick={() => openEdit(apt)}
      className="flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.99]"
    >
      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-foreground">
        <span className="text-[10px] font-bold uppercase leading-none">{format(parseISO(apt.date), "MMM")}</span>
        <span className="text-[17px] font-extrabold leading-tight">{format(parseISO(apt.date), "d")}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold">{apt.title}</p>
        <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          {relativeDayLabel(apt.date)} · {formatTime12(apt.time)}
        </p>
        {apt.location && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{apt.location}</span>
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Calendar"
        subtitle={`${upcoming.length} upcoming`}
        actions={
          <>
            <div className="flex rounded-full bg-muted p-1">
              <button
                onClick={() => setView("list")}
                aria-label="List view"
                className={cn(
                  "flex h-8 w-9 items-center justify-center rounded-full transition-all",
                  view === "list" ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("month")}
                aria-label="Month view"
                className={cn(
                  "flex h-8 w-9 items-center justify-center rounded-full transition-all",
                  view === "month" ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                <CalendarIconMini />
              </button>
            </div>
            <Button
              size="icon"
              aria-label="Add appointment"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm(view === "month" ? selectedDay : undefined));
                setSheetOpen(true);
              }}
              className="h-10 w-10 rounded-full shadow-md shadow-primary/20"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </>
        }
      />

      {view === "list" ? (
        <div className="space-y-2.5 px-4 pt-4">
          {upcoming.length === 0 && past.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl bg-card py-14 text-center shadow-sm ring-1 ring-border">
              <CalendarX2 className="h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 text-[15px] font-bold">No appointments</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Add your first appointment to see it here.</p>
            </div>
          )}
          {upcoming.map((apt) => (
            <AppointmentRow key={apt.id} apt={apt} />
          ))}
          {past.length > 0 && (
            <>
              <p className="px-1 pt-4 text-[13px] font-bold text-muted-foreground">Past</p>
              {past.slice(0, 5).map((apt) => (
                <div key={apt.id} className="opacity-60">
                  <AppointmentRow apt={apt} />
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="px-4 pt-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between rounded-2xl bg-card px-2 py-2 shadow-sm ring-1 ring-border">
            <button
              onClick={() => setMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </button>
            <p className="text-[15px] font-extrabold tracking-tight">{format(month, "MMMM yyyy")}</p>
            <button
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-secondary"
            >
              <ChevronRight className="h-[18px] w-[18px]" />
            </button>
          </div>

          {/* Grid */}
          <div className="mt-3 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border">
            <div className="grid grid-cols-7 text-center text-[11px] font-bold text-muted-foreground">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <span key={d} className="py-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const hasEvents = sorted.some((a) => isSameDay(parseISO(a.date), day));
                const selected = isSameDay(day, selectedDay);
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "relative mx-auto my-0.5 flex h-10 w-10 flex-col items-center justify-center rounded-full text-[13px] font-semibold transition-all",
                      !isSameMonth(day, month) && "text-muted-foreground/40",
                      selected
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                        : isToday(day)
                          ? "bg-primary/10 text-primary dark:text-foreground"
                          : "hover:bg-secondary",
                    )}
                  >
                    {format(day, "d")}
                    {hasEvents && (
                      <span
                        className={cn(
                          "absolute bottom-1 h-1 w-1 rounded-full",
                          selected ? "bg-primary-foreground" : "bg-primary dark:bg-info",
                        )}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected day */}
          <p className="px-1 pt-5 text-[13px] font-bold text-muted-foreground">
            {format(selectedDay, "EEEE, d MMMM")}
          </p>
          <div className="space-y-2.5 pt-2">
            {dayAppointments.length === 0 ? (
              <div className="rounded-2xl bg-card py-8 text-center shadow-sm ring-1 ring-border">
                <p className="text-[13px] text-muted-foreground">Nothing scheduled this day.</p>
              </div>
            ) : (
              dayAppointments.map((apt) => <AppointmentRow key={apt.id} apt={apt} />)
            )}
          </div>
        </div>
      )}

      {/* Add / Edit sheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingId ? "Edit Appointment" : "Add Appointment"}
      >
        <div className="space-y-4">
          <Field label="Title">
            <Input
              placeholder="e.g. Dentist check-up"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-12 rounded-xl"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
          </div>

          <Field label="Location">
            <Input
              placeholder="e.g. City Dental, Pitt St"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              className="h-12 rounded-xl"
            />
          </Field>

          <Field label="Reminder">
            <ChipPicker
              options={APPOINTMENT_REMINDERS}
              value={form.reminder}
              onChange={(reminder) => setForm((f) => ({ ...f, reminder }))}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              placeholder="Optional notes..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="min-h-[70px] rounded-xl"
            />
          </Field>

          <div className="flex gap-3 pt-1">
            {editingId && (
              <Button
                type="button"
                variant="outline"
                aria-label="Delete appointment"
                onClick={() => {
                  deleteAppointment(editingId);
                  setSheetOpen(false);
                  toast.success("Appointment deleted");
                }}
                className="h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Button onClick={handleSave} className="h-12 flex-1 rounded-xl text-[15px] font-bold shadow-md shadow-primary/20">
              {editingId ? "Save Changes" : "Add Appointment"}
            </Button>
          </div>
        </div>
      </FormSheet>
    </div>
  );
}

function CalendarIconMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
