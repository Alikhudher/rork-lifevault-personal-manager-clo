import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, isSameDay, isSameMonth, isSameWeek, parseISO } from "date-fns";
import { ArrowRight, Plus, ReceiptText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, SectionTitle } from "@/components/lifevault/PageHeader";
import { ChipPicker, Field, FormSheet } from "@/components/lifevault/FormSheet";
import { CategoryBubble, EXPENSE_META, PAYMENT_META } from "@/components/lifevault/category-meta";
import { useApp } from "@/context/AppContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, formatTime12 } from "@/lib/format";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_BAR_COLORS: Record<ExpenseCategory, string> = {
  Food: "bg-orange-500",
  Fuel: "bg-amber-500",
  Rent: "bg-indigo-500",
  Bills: "bg-sky-500",
  Shopping: "bg-pink-500",
  Transport: "bg-teal-500",
  Health: "bg-rose-500",
  Entertainment: "bg-violet-500",
  Subscriptions: "bg-blue-500",
  Other: "bg-slate-500",
};

interface ExpenseFormState {
  amount: string;
  date: string;
  time: string;
  category: ExpenseCategory;
  merchant: string;
  notes: string;
  paymentMethod: PaymentMethod;
}

function emptyForm(): ExpenseFormState {
  return {
    amount: "",
    date: format(new Date(), "yyyy-MM-dd"),
    time: format(new Date(), "HH:mm"),
    category: "Food",
    merchant: "",
    notes: "",
    paymentMethod: "Debit Card",
  };
}

export default function Expenses() {
  const { expenses, settings, addExpense, updateExpense, deleteExpense } = useApp();
  const { t, fmtDate, relativeDay } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [form, setForm] = useState<ExpenseFormState>(emptyForm());
  const currency = settings.currency;
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditingId(null);
      setForm(emptyForm());
      setSheetOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const stats = useMemo(() => {
    const today = expenses.filter((e) => isSameDay(parseISO(e.date), now));
    const week = expenses.filter((e) => isSameWeek(parseISO(e.date), now, { weekStartsOn: 1 }));
    const month = expenses.filter((e) => isSameMonth(parseISO(e.date), now));
    const monthTotal = month.reduce((sum, e) => sum + e.amount, 0);

    const byCategory = new Map<ExpenseCategory, number>();
    for (const e of month) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }
    const categories = [...byCategory.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    return {
      todayTotal: today.reduce((sum, e) => sum + e.amount, 0),
      weekTotal: week.reduce((sum, e) => sum + e.amount, 0),
      monthTotal,
      categories,
      // Guard against a 0 budget so the bar never renders NaN%.
      budgetPct:
        settings.monthlyBudget > 0
          ? Math.min(100, Math.round((monthTotal / settings.monthlyBudget) * 100))
          : 0,
      remaining: settings.monthlyBudget - monthTotal,
    };
  }, [expenses, settings.monthlyBudget, now]);

  const recent = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12),
    [expenses],
  );

  const openEdit = (expense: Expense) => {
    const d = parseISO(expense.date);
    setEditingId(expense.id);
    setForm({
      amount: String(expense.amount),
      date: format(d, "yyyy-MM-dd"),
      time: format(d, "HH:mm"),
      category: expense.category,
      merchant: expense.merchant,
      notes: expense.notes,
      paymentMethod: expense.paymentMethod,
    });
    setSheetOpen(true);
  };

  const handleSave = () => {
    const amount = Number.parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t("expenses.invalidAmount"));
      return;
    }
    if (!form.date) {
      toast.error(t("expenses.pickDate"));
      return;
    }
    const iso = new Date(`${form.date}T${form.time || "12:00"}`).toISOString();
    const payload = {
      amount: Math.round(amount * 100) / 100,
      date: iso,
      category: form.category,
      merchant: form.merchant.trim() || "Unknown merchant",
      notes: form.notes.trim(),
      paymentMethod: form.paymentMethod,
    };
    if (editingId) {
      updateExpense(editingId, payload);
      toast.success(t("expenses.updated"));
    } else {
      addExpense(payload);
      toast.success(t("expenses.added", { amount: formatCurrency(payload.amount, currency) }));
    }
    setSheetOpen(false);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t("expenses.title")}
        subtitle={fmtDate(now.toISOString(), "MMMM yyyy")}
        actions={
          <Button
            size="icon"
            aria-label={t("expenses.addExpense")}
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm());
              setSheetOpen(true);
            }}
            className="h-10 w-10 rounded-full shadow-md shadow-primary/20"
          >
            <Plus className="h-5 w-5" />
          </Button>
        }
      />

      {/* Totals */}
      <section className="grid grid-cols-3 gap-2.5 px-4 pt-4">
        {[
          { label: t("expenses.today"), value: stats.todayTotal },
          { label: t("expenses.thisWeek"), value: stats.weekTotal },
          { label: t("expenses.thisMonth"), value: stats.monthTotal },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="mt-1 truncate text-[17px] font-extrabold tracking-tight tabular">
              {formatCurrency(item.value, currency)}
            </p>
          </div>
        ))}
      </section>

      {/* Budget */}
      <section className="px-4 pt-4">
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          <div className="flex items-baseline justify-between">
            <p className="text-[14px] font-bold">{t("expenses.monthlyBudget")}</p>
            <p className="text-[13px] font-semibold text-muted-foreground tabular">
              {formatCurrency(stats.monthTotal, currency)} / {formatCurrency(settings.monthlyBudget, currency, true)}
            </p>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                stats.budgetPct >= 90 ? "bg-destructive" : stats.budgetPct >= 75 ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${stats.budgetPct}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {settings.monthlyBudget <= 0 ? (
              t("expenses.noBudget")
            ) : stats.remaining >= 0 ? (
              <span className="font-semibold text-foreground">
                {t("expenses.remaining", { amount: formatCurrency(stats.remaining, currency) })}
              </span>
            ) : (
              <span className="font-bold text-destructive">
                {t("expenses.overBudget", { amount: formatCurrency(Math.abs(stats.remaining), currency) })}
              </span>
            )}
          </p>
        </div>
      </section>

      {/* By category */}
      {stats.categories.length > 0 && (
        <section className="px-4 pt-6">
          <SectionTitle>{t("expenses.byCategory")}</SectionTitle>
          <div className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
            {stats.categories.slice(0, 6).map(({ category, total }) => {
              const pct = stats.monthTotal > 0 ? Math.round((total / stats.monthTotal) * 100) : 0;
              return (
                <div key={category}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-bold">{t(`expenseCategories.${category}`)}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(total, currency)} · {pct}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all duration-700", CATEGORY_BAR_COLORS[category])}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Subscriptions link */}
      <section className="px-4 pt-4">
        <Link
          to="/subscriptions"
          className="flex items-center justify-between rounded-2xl bg-accent px-4 py-3.5 text-accent-foreground ring-1 ring-border transition-transform active:scale-[0.99]"
        >
          <span className="text-[14px] font-bold">{t("expenses.manageSubs")}</span>
          <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" />
        </Link>
      </section>

      {/* Recent */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("expenses.recent")}</SectionTitle>
        {recent.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-card py-14 text-center shadow-sm ring-1 ring-border">
            <ReceiptText className="h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-[15px] font-bold">{t("expenses.emptyTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("expenses.emptySub")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            {recent.map((expense, i) => {
              const PayIcon = PAYMENT_META[expense.paymentMethod];
              return (
                <button
                  key={expense.id}
                  onClick={() => openEdit(expense)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40",
                    i > 0 && "border-t border-border/70",
                  )}
                >
                  <CategoryBubble meta={EXPENSE_META[expense.category]} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{expense.merchant}</p>
                    <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
                      <PayIcon className="h-3 w-3" />
                      {relativeDay(expense.date)} · {formatTime12(format(parseISO(expense.date), "HH:mm"))}
                    </p>
                  </div>
                  <p className="text-[14px] font-extrabold tabular">-{formatCurrency(expense.amount, currency)}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Add / Edit sheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingId ? t("expenses.editExpense") : t("expenses.addExpense")}
      >
        <div className="space-y-4">
          <Field label={t("expenses.amountLabel", { currency })}>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="h-14 rounded-xl text-[22px] font-extrabold tabular"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("common.date")}>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label={t("common.time")}>
              <Input
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
          </div>

          <Field label={t("common.category")}>
            <ChipPicker
              options={EXPENSE_CATEGORIES}
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              render={(category) => t(`expenseCategories.${category}`)}
            />
          </Field>

          <Field label={t("expenses.merchant")}>
            <Input
              placeholder={t("expenses.merchantPh")}
              value={form.merchant}
              onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
              className="h-12 rounded-xl"
            />
          </Field>

          <Field label={t("expenses.paymentMethod")}>
            <ChipPicker
              options={PAYMENT_METHODS}
              value={form.paymentMethod}
              onChange={(paymentMethod) => setForm((f) => ({ ...f, paymentMethod }))}
              render={(method) => t(`paymentMethods.${method}`)}
            />
          </Field>

          <Field label={t("common.notes")}>
            <Textarea
              placeholder={t("expenses.notesPh")}
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
                aria-label={t("common.delete")}
                onClick={() => setConfirmDelete(true)}
                className="h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Button onClick={handleSave} className="h-12 flex-1 rounded-xl text-[15px] font-bold shadow-md shadow-primary/20">
              {editingId ? t("expenses.saveChanges") : t("expenses.addExpense")}
            </Button>
          </div>
        </div>
      </FormSheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenses.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("expenses.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!editingId) return;
                deleteExpense(editingId);
                setConfirmDelete(false);
                setSheetOpen(false);
                toast.success(t("expenses.deleted"));
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
