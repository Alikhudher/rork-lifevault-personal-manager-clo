import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { CircleSlash, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionTitle } from "@/components/lifevault/PageHeader";
import { ChipPicker, Field, FormSheet } from "@/components/lifevault/FormSheet";
import { SubStatusBadge } from "@/components/lifevault/StatusBadge";
import { CategoryBubble, EXPENSE_META, PAYMENT_META } from "@/components/lifevault/category-meta";
import { useApp } from "@/context/AppContext";
import {
  daysUntilLabel,
  formatCurrency,
  formatDateShort,
  frequencyLabel,
  monthlyEquivalent,
} from "@/lib/format";
import {
  BILLING_FREQUENCIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  REMINDER_OPTIONS,
  type BillingFrequency,
  type ExpenseCategory,
  type PaymentMethod,
  type ReminderDays,
  type Subscription,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SubFormState {
  name: string;
  price: string;
  frequency: BillingFrequency;
  nextPaymentDate: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  reminderDays: ReminderDays;
}

function emptyForm(): SubFormState {
  return {
    name: "",
    price: "",
    frequency: "monthly",
    nextPaymentDate: format(new Date(), "yyyy-MM-dd"),
    category: "Subscriptions",
    paymentMethod: "Credit Card",
    reminderDays: 7,
  };
}

export default function Subscriptions() {
  const { subscriptions, settings, addSubscription, updateSubscription, deleteSubscription } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"active" | "cancelled">("active");
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SubFormState>(emptyForm());
  const currency = settings.currency;

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setEditingId(null);
      setForm(emptyForm());
      setSheetOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const active = useMemo(
    () =>
      subscriptions
        .filter((s) => s.status === "active")
        .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate)),
    [subscriptions],
  );
  const cancelled = useMemo(() => subscriptions.filter((s) => s.status === "cancelled"), [subscriptions]);

  const monthlyTotal = useMemo(
    () => active.reduce((sum, s) => sum + monthlyEquivalent(s.price, s.frequency), 0),
    [active],
  );

  const openEdit = (sub: Subscription) => {
    setEditingId(sub.id);
    setForm({
      name: sub.name,
      price: String(sub.price),
      frequency: sub.frequency,
      nextPaymentDate: sub.nextPaymentDate,
      category: sub.category,
      paymentMethod: sub.paymentMethod,
      reminderDays: sub.reminderDays,
    });
    setSheetOpen(true);
  };

  const editingSub = editingId ? subscriptions.find((s) => s.id === editingId) : undefined;

  const handleSave = () => {
    const price = Number.parseFloat(form.price);
    if (!form.name.trim()) {
      toast.error("Enter a subscription name");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    const payload = {
      name: form.name.trim(),
      price: Math.round(price * 100) / 100,
      frequency: form.frequency,
      nextPaymentDate: form.nextPaymentDate,
      category: form.category,
      paymentMethod: form.paymentMethod,
      reminderDays: form.reminderDays,
    };
    if (editingId) {
      updateSubscription(editingId, payload);
      toast.success("Subscription updated");
    } else {
      addSubscription({ ...payload, status: "active" });
      toast.success(`${payload.name} added`);
    }
    setSheetOpen(false);
  };

  const list = tab === "active" ? active : cancelled;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Subscriptions"
        subtitle="Recurring payments"
        back
        actions={
          <Button
            size="icon"
            aria-label="Add subscription"
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
      <section className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="rounded-2xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-4 text-white shadow-lg shadow-primary/15">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Monthly</p>
          <p className="mt-1 text-[22px] font-extrabold tracking-tight tabular">
            {formatCurrency(monthlyTotal, currency)}
          </p>
          <p className="text-[12px] text-white/60">{active.length} active</p>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Yearly</p>
          <p className="mt-1 text-[22px] font-extrabold tracking-tight tabular">
            {formatCurrency(monthlyTotal * 12, currency)}
          </p>
          <p className="text-[12px] text-muted-foreground">projected</p>
        </div>
      </section>

      {/* Tabs */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(["active", "cancelled"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-lg py-1.5 text-[13px] font-bold capitalize transition-all",
                tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {value} ({value === "active" ? active.length : cancelled.length})
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2.5 px-4 pt-4">
        {tab === "active" && <SectionTitle>Upcoming renewals</SectionTitle>}
        {list.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl bg-card py-14 text-center shadow-sm ring-1 ring-border">
            {tab === "active" ? (
              <RefreshCcw className="h-10 w-10 text-muted-foreground/50" />
            ) : (
              <CircleSlash className="h-10 w-10 text-muted-foreground/50" />
            )}
            <p className="mt-3 text-[15px] font-bold">
              {tab === "active" ? "No active subscriptions" : "No cancelled subscriptions"}
            </p>
          </div>
        ) : (
          list.map((sub) => {
            const PayIcon = PAYMENT_META[sub.paymentMethod];
            return (
              <button
                key={sub.id}
                onClick={() => openEdit(sub)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.99]",
                  sub.status === "cancelled" && "opacity-70",
                )}
              >
                <CategoryBubble meta={EXPENSE_META[sub.category]} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{sub.name}</p>
                  <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
                    <PayIcon className="h-3 w-3" />
                    {sub.status === "active"
                      ? `Renews ${daysUntilLabel(sub.nextPaymentDate)} · ${formatDateShort(sub.nextPaymentDate)}`
                      : "Cancelled"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-extrabold tabular">{formatCurrency(sub.price, currency)}</p>
                  <p className="text-[11px] text-muted-foreground">/{frequencyLabel(sub.frequency)}</p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Add / Edit sheet */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editingId ? "Edit Subscription" : "Add Subscription"}
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input
              placeholder="e.g. Netflix"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-12 rounded-xl"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Price (${currency})`}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="h-12 rounded-xl font-bold tabular"
              />
            </Field>
            <Field label="Next payment">
              <Input
                type="date"
                value={form.nextPaymentDate}
                onChange={(e) => setForm((f) => ({ ...f, nextPaymentDate: e.target.value }))}
                className="h-12 rounded-xl"
              />
            </Field>
          </div>

          <Field label="Billing frequency">
            <ChipPicker
              options={BILLING_FREQUENCIES}
              value={form.frequency}
              onChange={(frequency) => setForm((f) => ({ ...f, frequency }))}
              render={(f) => f.charAt(0).toUpperCase() + f.slice(1)}
            />
          </Field>

          <Field label="Category">
            <ChipPicker
              options={EXPENSE_CATEGORIES}
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
            />
          </Field>

          <Field label="Payment method">
            <ChipPicker
              options={PAYMENT_METHODS}
              value={form.paymentMethod}
              onChange={(paymentMethod) => setForm((f) => ({ ...f, paymentMethod }))}
            />
          </Field>

          <Field label="Remind me before renewal">
            <ChipPicker
              options={REMINDER_OPTIONS}
              value={form.reminderDays}
              onChange={(reminderDays) => setForm((f) => ({ ...f, reminderDays }))}
              render={(days) => `${days} days`}
            />
          </Field>

          {editingSub && (
            <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3">
              <div>
                <p className="text-[13px] font-bold">Status</p>
                <SubStatusBadge status={editingSub.status} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg font-bold"
                onClick={() => {
                  const next = editingSub.status === "active" ? "cancelled" : "active";
                  updateSubscription(editingSub.id, { status: next });
                  toast.success(next === "cancelled" ? "Subscription cancelled" : "Subscription reactivated");
                }}
              >
                {editingSub.status === "active" ? "Cancel subscription" : "Reactivate"}
              </Button>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            {editingId && (
              <Button
                type="button"
                variant="outline"
                aria-label="Delete subscription"
                onClick={() => {
                  deleteSubscription(editingId);
                  setSheetOpen(false);
                  toast.success("Subscription deleted");
                }}
                className="h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </Button>
            )}
            <Button onClick={handleSave} className="h-12 flex-1 rounded-xl text-[15px] font-bold shadow-md shadow-primary/20">
              {editingId ? "Save Changes" : "Add Subscription"}
            </Button>
          </div>
        </div>
      </FormSheet>
    </div>
  );
}
