import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isSameDay, isSameMonth, parseISO } from "date-fns";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarPlus,
  FilePlus2,
  FileWarning,
  PiggyBank,
  Plus,
  RefreshCcw,
  Wallet,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import {
  daysUntil,
  daysUntilLabel,
  documentStatus,
  formatCurrency,
  formatDateShort,
  formatTime12,
  initials,
  relativeDayLabel,
} from "@/lib/format";
import { CategoryBubble, EXPENSE_META } from "@/components/lifevault/category-meta";
import { SectionTitle } from "@/components/lifevault/PageHeader";
import { cn } from "@/lib/utils";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const QUICK_ACTIONS = [
  { label: "Document", icon: FilePlus2, to: "/documents?add=1" },
  { label: "Expense", icon: Wallet, to: "/expenses?add=1" },
  { label: "Subscription", icon: RefreshCcw, to: "/subscriptions?add=1" },
  { label: "Appointment", icon: CalendarPlus, to: "/calendar?add=1" },
];

export default function Home() {
  const { user, settings, expenses, subscriptions, documents, appointments, unreadCount } = useApp();
  const navigate = useNavigate();
  const now = new Date();
  const currency = settings.currency;

  const stats = useMemo(() => {
    const spentToday = expenses
      .filter((e) => isSameDay(parseISO(e.date), now))
      .reduce((sum, e) => sum + e.amount, 0);
    const spentMonth = expenses
      .filter((e) => isSameMonth(parseISO(e.date), now))
      .reduce((sum, e) => sum + e.amount, 0);

    const upcoming = subscriptions
      .filter((s) => s.status === "active" && daysUntil(s.nextPaymentDate) >= 0 && daysUntil(s.nextPaymentDate) <= 30)
      .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate));

    const expiring = documents.filter((d) => documentStatus(d) !== "active");

    const upcomingAppointments = appointments
      .filter((a) => daysUntil(a.date) >= 0)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

    return {
      spentToday,
      spentMonth,
      upcoming,
      upcomingTotal: upcoming.reduce((sum, s) => sum + s.price, 0),
      expiring,
      upcomingAppointments,
      remaining: settings.monthlyBudget - spentMonth,
      budgetPct: Math.min(100, Math.round((spentMonth / settings.monthlyBudget) * 100)),
    };
  }, [expenses, subscriptions, documents, appointments, settings.monthlyBudget, now]);

  const recentExpenses = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4),
    [expenses],
  );

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="flex items-center justify-between px-4 pb-2 pt-6">
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-[14px] font-extrabold text-primary-foreground shadow-md shadow-primary/20"
          >
            {initials(user?.name ?? "You")}
          </Link>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{greeting()}</p>
            <h1 className="text-[19px] font-extrabold leading-tight tracking-tight">
              {user?.name.split(" ")[0] ?? "there"}
            </h1>
          </div>
        </div>
        <Link
          to="/notifications"
          aria-label="Notifications"
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-sm ring-1 ring-border transition-transform active:scale-95"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-extrabold text-destructive-foreground ring-2 ring-background">
              {unreadCount}
            </span>
          )}
        </Link>
      </header>

      {/* Budget hero */}
      <section className="px-4 pt-3">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] via-[hsl(218,57%,20%)] to-[hsl(215,55%,30%)] p-5 text-white shadow-xl shadow-primary/20">
          <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/5" aria-hidden />
          <div className="absolute -bottom-20 -left-8 h-48 w-48 rounded-full bg-info/15 blur-2xl" aria-hidden />
          <div className="relative">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-white/60">Spent this month</p>
            <p className="mt-1 text-[34px] font-extrabold tracking-tight tabular">
              {formatCurrency(stats.spentMonth, currency)}
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  stats.budgetPct >= 90 ? "bg-red-400" : stats.budgetPct >= 75 ? "bg-amber-400" : "bg-emerald-400",
                )}
                style={{ width: `${stats.budgetPct}%` }}
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[13px]">
              <span className="text-white/60">{stats.budgetPct}% of {formatCurrency(settings.monthlyBudget, currency, true)} budget</span>
              <span className="font-bold">
                {stats.remaining >= 0
                  ? `${formatCurrency(stats.remaining, currency)} left`
                  : `${formatCurrency(Math.abs(stats.remaining), currency)} over`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stat grid */}
      <section className="grid grid-cols-2 gap-3 px-4 pt-4">
        <button
          onClick={() => navigate("/expenses")}
          className="rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.98]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-info/12 text-info">
            <Wallet className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-[20px] font-extrabold tracking-tight tabular">
            {formatCurrency(stats.spentToday, currency)}
          </p>
          <p className="text-[12px] font-semibold text-muted-foreground">Spent today</p>
        </button>
        <button
          onClick={() => navigate("/subscriptions")}
          className="rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.98]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-400">
            <PiggyBank className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-[20px] font-extrabold tracking-tight tabular">
            {formatCurrency(stats.upcomingTotal, currency)}
          </p>
          <p className="text-[12px] font-semibold text-muted-foreground">
            {stats.upcoming.length} payment{stats.upcoming.length === 1 ? "" : "s"} due in 30d
          </p>
        </button>
        <button
          onClick={() => navigate("/documents")}
          className="rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.98]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/12 text-warning">
            <FileWarning className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-[20px] font-extrabold tracking-tight tabular">{stats.expiring.length}</p>
          <p className="text-[12px] font-semibold text-muted-foreground">Documents need attention</p>
        </button>
        <button
          onClick={() => navigate("/calendar")}
          className="rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-border transition-transform active:scale-[0.98]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/12 text-success">
            <CalendarClock className="h-[18px] w-[18px]" />
          </span>
          <p className="mt-3 text-[20px] font-extrabold tracking-tight tabular">
            {stats.upcomingAppointments.length}
          </p>
          <p className="text-[12px] font-semibold text-muted-foreground">Upcoming appointments</p>
        </button>
      </section>

      {/* Quick actions */}
      <section className="px-4 pt-6">
        <SectionTitle>Quick add</SectionTitle>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => navigate(action.to)}
              className="group flex flex-col items-center gap-2 rounded-2xl bg-card py-3.5 shadow-sm ring-1 ring-border transition-all active:scale-95"
            >
              <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground dark:text-foreground">
                <action.icon className="h-5 w-5" />
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
                  <Plus className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              </span>
              <span className="text-[11px] font-bold">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Upcoming payments */}
      {stats.upcoming.length > 0 && (
        <section className="px-4 pt-6">
          <SectionTitle
            action={
              <Link to="/subscriptions" className="flex items-center gap-0.5 text-[13px] font-bold text-primary dark:text-foreground">
                See all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            Upcoming payments
          </SectionTitle>
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
            {stats.upcoming.slice(0, 3).map((sub, i) => (
              <div
                key={sub.id}
                className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border/70")}
              >
                <CategoryBubble meta={EXPENSE_META[sub.category]} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{sub.name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    Due {daysUntilLabel(sub.nextPaymentDate)} · {formatDateShort(sub.nextPaymentDate)}
                  </p>
                </div>
                <p className="text-[14px] font-extrabold tabular">{formatCurrency(sub.price, currency)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Next appointment */}
      {stats.upcomingAppointments.length > 0 && (
        <section className="px-4 pt-6">
          <SectionTitle
            action={
              <Link to="/calendar" className="flex items-center gap-0.5 text-[13px] font-bold text-primary dark:text-foreground">
                Calendar <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            Next appointment
          </SectionTitle>
          <Link
            to="/calendar"
            className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border transition-transform active:scale-[0.99]"
          >
            <span className="flex h-11 w-11 flex-col items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold">{stats.upcomingAppointments[0].title}</p>
              <p className="text-[12px] text-muted-foreground">
                {relativeDayLabel(stats.upcomingAppointments[0].date)} ·{" "}
                {formatTime12(stats.upcomingAppointments[0].time)}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </section>
      )}

      {/* Recent activity */}
      <section className="px-4 pt-6">
        <SectionTitle
          action={
            <Link to="/expenses" className="flex items-center gap-0.5 text-[13px] font-bold text-primary dark:text-foreground">
              See all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          Recent activity
        </SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
          {recentExpenses.map((expense, i) => (
            <div
              key={expense.id}
              className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border/70")}
            >
              <CategoryBubble meta={EXPENSE_META[expense.category]} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{expense.merchant}</p>
                <p className="text-[12px] text-muted-foreground">
                  {relativeDayLabel(expense.date)} · {expense.category}
                </p>
              </div>
              <p className="text-[14px] font-extrabold tabular">-{formatCurrency(expense.amount, currency)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
