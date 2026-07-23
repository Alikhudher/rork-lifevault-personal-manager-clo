import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isSameMonth, parseISO } from "date-fns";
import {
  Bell,
  Bug,
  Calendar,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Download,
  FileText,
  HelpCircle,
  Info,
  KeyRound,
  Languages,
  LifeBuoy,
  LogOut,
  MessageSquarePlus,
  Moon,
  PiggyBank,
  Share2,
  Shield,
  ShieldCheck,
  Smartphone,
  Crown,
  Sparkles,
  Star,
  Trash2,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Field, FormSheet } from "@/components/lifevault/FormSheet";
import {
  ActiveSessionsSheet,
  ChangePasswordSheet,
  EditProfileSheet,
  FaqSheet,
  RateAppSheet,
  ShareAppSheet,
  SupportSheet,
  WhatsNewSheet,
} from "@/components/lifevault/AccountSheets";
import { accountHasPassword, useApp } from "@/context/AppContext";
import { useI18n } from "@/context/I18nContext";
import { formatCurrency, initials } from "@/lib/format";
import { isLanguageCode, LANGUAGES } from "@/lib/i18n";
import { dismissKeyboard, subscribeKeyboard } from "@/lib/keyboard";
import { CURRENCIES } from "@/lib/types";
import { cn } from "@/lib/utils";

const APP_VERSION = "1.0.0";

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: "A$",
  USD: "$",
  EUR: "€",
  GBP: "£",
  NZD: "NZ$",
  CAD: "C$",
};

const QUICK_BUDGET_AMOUNTS = [1000, 2000, 3000, 5000];

/**
 * Monthly budget editor.
 *
 * - Large 28px amount field: iOS only auto-zooms inputs below 16px, so the
 *   viewport never jumps when the field is focused.
 * - An iOS-style "Done" accessory bar is pinned directly above the numeric
 *   keyboard (the sheet footer rides on top of the keyboard) so editing can
 *   always be finished.
 * - Done and Save both write straight to settings, so the Home dashboard
 *   progress bar updates instantly — no restart needed.
 */
function BudgetSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings, expenses, updateSettings } = useApp();
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>("");
  const [keyboardOpen, setKeyboardOpen] = useState<boolean>(false);

  const symbol = CURRENCY_SYMBOLS[settings.currency] ?? settings.currency;

  // Re-seed the draft each time the sheet opens.
  useEffect(() => {
    if (open) {
      setDraft(settings.monthlyBudget > 0 ? String(settings.monthlyBudget) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setKeyboardOpen(false);
      return;
    }
    return subscribeKeyboard((state) => setKeyboardOpen(state.inset > 0));
  }, [open]);

  const spentThisMonth = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((e) => isSameMonth(parseISO(e.date), now))
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let cleaned = e.target.value.replace(/[^0-9.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`;
    }
    // Replace a lone leading zero before a new digit: "0" + "5" -> "5".
    if (/^0\d/.test(cleaned)) cleaned = cleaned.replace(/^0+/, "");
    setDraft(cleaned);
  };

  /** Persist the draft — Home reads the same context state and refreshes immediately. */
  const commit = () => {
    const n = Number.parseFloat(draft);
    const amount = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
    updateSettings({ monthlyBudget: amount });
  };

  // "Done" saves the value and dismisses the keyboard, keeping the sheet
  // open so the user can review before closing.
  const handleDone = () => {
    commit();
    dismissKeyboard();
  };

  const handleSave = () => {
    commit();
    dismissKeyboard();
    onOpenChange(false);
    toast.success(t("budget.saved"), { description: t("budget.savedDesc") });
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("budget.title")}
      description={t("budget.description")}
      footer={
        keyboardOpen ? (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-muted-foreground">
              {t("budget.doneHint")}
            </span>
            <Button
              type="button"
              onClick={handleDone}
              className="h-10 shrink-0 rounded-xl px-6 text-[14px] font-extrabold"
            >
              {t("common.done")}
            </Button>
          </div>
        ) : (
          <Button
            onClick={handleSave}
            className="h-12 w-full rounded-xl text-[15px] font-bold shadow-md shadow-primary/20"
          >
            {t("budget.save")}
          </Button>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <Field label={t("budget.amountLabel", { currency: settings.currency })}>
          <div className="flex items-center gap-2.5 rounded-2xl bg-secondary/50 px-4 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
            <span className="shrink-0 select-none text-[20px] font-extrabold text-muted-foreground">
              {symbol}
            </span>
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={draft}
              onChange={handleChange}
              placeholder="0"
              aria-label={t("budget.amountLabel", { currency: settings.currency })}
              className="h-16 min-w-0 flex-1 border-0 bg-transparent px-0 font-extrabold tabular shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              style={{ fontSize: "28px" }}
            />
          </div>
        </Field>

        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("budget.quickAmounts")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_BUDGET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setDraft(String(amount))}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[13px] font-bold transition-all active:scale-95",
                  draft === String(amount)
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {formatCurrency(amount, settings.currency, true)}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-info/8 px-3.5 py-2.5 text-[12.5px] font-semibold text-info">
          {t("budget.spentSoFar", { amount: formatCurrency(spentThisMonth, settings.currency) })}
        </div>
        <p className="text-[12px] text-muted-foreground">{t("budget.noBudgetHint")}</p>
      </form>
    </FormSheet>
  );
}

type SheetKind =
  | "edit"
  | "password"
  | "sessions"
  | "contact"
  | "bug"
  | "feature"
  | "faq"
  | "whatsNew"
  | "rate"
  | "share"
  | null;

function SettingRow({
  icon: Icon,
  bubble,
  title,
  subtitle,
  right,
  onClick,
  danger,
  isLast,
}: {
  icon: typeof Bell;
  bubble: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  isLast?: boolean;
}) {
  const content = (
    <>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", bubble)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 text-start">
        <span className={cn("block text-[14px] font-bold", danger && "text-destructive")}>{title}</span>
        {subtitle && <span className="block text-[12px] text-muted-foreground">{subtitle}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" /> : null)}
    </>
  );
  const className = cn(
    "flex w-full items-center gap-3 px-4 py-3.5",
    !isLast && "border-b border-border/70",
    onClick && "transition-colors hover:bg-secondary/40 active:bg-secondary/60",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">{children}</div>
  );
}

export default function Profile() {
  const {
    user,
    accounts,
    settings,
    updateSettings,
    signOut,
    deleteAccount,
    verifyAccountPassword,
    documents,
    expenses,
    subscriptions,
    appointments,
    sessions,
  } = useApp();
  const { t, language, setLanguage } = useI18n();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deletePassword, setDeletePassword] = useState<string>("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [legalDoc, setLegalDoc] = useState<"privacy" | "terms" | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [budgetOpen, setBudgetOpen] = useState<boolean>(false);

  /** Deleting the account is a sensitive action — the password is verified first. */
  const deleteRequiresPassword = useMemo(() => {
    const account = accounts.find(
      (a) => a.email.toLowerCase() === (user?.email ?? "").toLowerCase(),
    );
    return accountHasPassword(account);
  }, [accounts, user?.email]);

  const handleConfirmDelete = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Keep the dialog open until verification passes.
    e.preventDefault();
    if (deleting) return;
    setDeleteError(null);
    if (deleteRequiresPassword) {
      if (!deletePassword) {
        setDeleteError(t("profile.deletePasswordWrong"));
        return;
      }
      setDeleting(true);
      const ok = await verifyAccountPassword(deletePassword);
      setDeleting(false);
      if (!ok) {
        setDeleteError(t("profile.deletePasswordWrong"));
        return;
      }
    }
    setConfirmDelete(false);
    deleteAccount();
    toast.success(t("profile.accountDeleted"));
    navigate("/onboarding");
  };

  const openSheet = (kind: Exclude<SheetKind, null>) => setSheet(kind);
  const closeSheet = () => setSheet(null);

  const handleExport = () => {
    const data = JSON.stringify({ user, settings, documents, expenses, subscriptions, appointments }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lifevault-export.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("profile.exported"));
  };

  const handleShare = async () => {
    const shareUrl = "https://lifevault.app";
    const shareText = "Check out LifeVault — one secure place for your documents, payments and appointments.";
    if (navigator.share) {
      try {
        await navigator.share({ title: "LifeVault", text: shareText, url: shareUrl });
      } catch {
        // user cancelled
      }
    } else {
      setSheet("share");
    }
  };

  const activeSessionsCount = sessions.length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        actions={
          <button
            type="button"
            onClick={() => openSheet("edit")}
            aria-label={t("profile.editAction")}
            className="flex h-10 items-center gap-1.5 rounded-full bg-secondary/70 px-3.5 text-[13px] font-bold text-secondary-foreground transition-colors hover:bg-secondary active:scale-95"
          >
            <UserCog className="h-4 w-4" /> {t("profile.editAction")}
          </button>
        }
      />

      {/* Profile hero card */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-5 text-white shadow-lg shadow-primary/15">
          {/* Cover photo — fills the header edge-to-edge with a centered
              cover crop (no letterboxing, no zoom-out). A navy scrim on top
              keeps the text and stats readable. */}
          {user?.photo && (
            <>
              <img
                src={user.photo}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-center"
              />
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[hsl(219,60%,15%)]/90 via-[hsl(219,60%,15%)]/78 to-[hsl(216,55%,28%)]/64"
                aria-hidden
              />
            </>
          )}
          {/* decorative glow */}
          <div
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-center gap-4">
            {/* Avatar is decorative only — editing is done via the Edit
                button in the header, so there's a single entry point. */}
            <Avatar className="h-16 w-16 shrink-0 rounded-full ring-2 ring-white/25" aria-hidden>
              {user?.photo ? (
                <AvatarImage src={user.photo} alt={user?.name ?? "Profile"} />
              ) : null}
              <AvatarFallback className="rounded-full bg-white/15 text-[20px] font-extrabold text-white">
                {initials(user?.name ?? "You")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-extrabold tracking-tight">{user?.name}</p>
              <p className="truncate text-[13px] text-white/65">{user?.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold">
                  <Shield className="h-3 w-3" /> {t("profile.vaultSecured")}
                </span>
                {user?.emailVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/25 px-2.5 py-0.5 text-[11px] font-bold text-white">
                    <ShieldCheck className="h-3 w-3" /> {t("profile.verified")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
            <Stat label={t("profile.statDocuments")} value={documents.length} />
            <Stat label={t("profile.statSessions")} value={activeSessionsCount} />
            <Stat
              label={t("profile.statMemberSince")}
              value={
                user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString(language === "ar" ? "ar" : "en-AU", {
                      month: "short",
                      year: "2-digit",
                    })
                  : "—"
              }
            />
          </div>
        </div>
      </section>

      {/* Premium */}
      <section className="px-4 pt-6">
        <button
          type="button"
          onClick={() => navigate("/premium")}
          className="relative flex w-full items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(43,90%,55%)] via-[hsl(38,85%,50%)] to-[hsl(28,80%,45%)] p-4 text-left text-white shadow-lg shadow-amber-500/20 transition-transform active:scale-[0.99]"
        >
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            <Crown className="h-6 w-6" strokeWidth={2.2} />
          </span>
          <div className="relative min-w-0 flex-1">
            <p className="text-[15px] font-extrabold tracking-tight">LifeVault Premium</p>
            <p className="truncate text-[12.5px] font-semibold text-white/80">
              All features currently free — upgrade coming soon
            </p>
          </div>
          <ChevronRight className="relative h-5 w-5 shrink-0 text-white/70 rtl:rotate-180" />
        </button>
      </section>

      {/* Account */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionAccount")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={KeyRound}
            bubble="bg-warning/12 text-warning"
            title={t("profile.changePassword")}
            onClick={() => openSheet("password")}
          />
          <SettingRow
            icon={Cloud}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title={t("profile.backupSync")}
            subtitle={t("profile.backupSyncSub")}
            onClick={() => navigate("/backup")}
          />
          <SettingRow
            icon={Shield}
            bubble="bg-info/12 text-info"
            title={t("profile.security")}
            subtitle={t("profile.securitySub")}
            onClick={() => navigate("/security")}
          />
          <SettingRow
            icon={Smartphone}
            bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            title={t("profile.activeSessions")}
            subtitle={
              activeSessionsCount === 1
                ? t("profile.deviceOne")
                : t("profile.devicesMany", { count: activeSessionsCount })
            }
            onClick={() => openSheet("sessions")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Support */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionSupport")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={LifeBuoy}
            bubble="bg-success/12 text-success"
            title={t("profile.contactSupport")}
            subtitle={t("profile.contactSupportSub")}
            onClick={() => openSheet("contact")}
          />
          <SettingRow
            icon={Bug}
            bubble="bg-destructive/12 text-destructive"
            title={t("profile.reportBug")}
            onClick={() => openSheet("bug")}
          />
          <SettingRow
            icon={MessageSquarePlus}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title={t("profile.requestFeature")}
            onClick={() => openSheet("feature")}
          />
          <SettingRow
            icon={HelpCircle}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title={t("profile.faq")}
            onClick={() => openSheet("faq")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* App */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionApp")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Info}
            bubble="bg-muted text-muted-foreground"
            title={t("profile.appVersion")}
            right={<span className="text-[13px] font-bold text-muted-foreground">v{APP_VERSION}</span>}
          />
          <SettingRow
            icon={Sparkles}
            bubble="bg-warning/12 text-warning"
            title={t("profile.whatsNew")}
            onClick={() => openSheet("whatsNew")}
          />
          <SettingRow
            icon={Star}
            bubble="bg-amber-500/12 text-amber-600 dark:text-amber-400"
            title={t("profile.rateApp")}
            onClick={() => openSheet("rate")}
          />
          <SettingRow
            icon={Share2}
            bubble="bg-info/12 text-info"
            title={t("profile.shareApp")}
            onClick={handleShare}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Preferences */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionPreferences")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Languages}
            bubble="bg-teal-500/12 text-teal-600 dark:text-teal-400"
            title={t("profile.language")}
            subtitle={t("profile.languageSub")}
            right={
              <Select
                value={language}
                onValueChange={(value) => {
                  if (isLanguageCode(value)) setLanguage(value);
                }}
              >
                <SelectTrigger
                  className="h-9 w-[124px] rounded-lg text-[13px] font-bold"
                  aria-label={t("profile.language")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            icon={CircleDollarSign}
            bubble="bg-success/12 text-success"
            title={t("profile.currency")}
            subtitle={t("profile.currencySub")}
            right={
              <Select value={settings.currency} onValueChange={(currency) => updateSettings({ currency })}>
                <SelectTrigger className="h-9 w-[104px] rounded-lg text-[13px] font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            icon={PiggyBank}
            bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            title={t("profile.monthlyBudget")}
            subtitle={t("profile.monthlyBudgetSub")}
            onClick={() => setBudgetOpen(true)}
            right={
              <span className="flex shrink-0 items-center gap-1 text-[13px] font-bold text-muted-foreground">
                <span className="tabular">{formatCurrency(settings.monthlyBudget, settings.currency, true)}</span>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </span>
            }
          />
          <SettingRow
            icon={Moon}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title={t("profile.darkMode")}
            right={
              <Switch
                checked={settings.darkMode}
                onCheckedChange={(darkMode) => updateSettings({ darkMode })}
                aria-label={t("profile.darkMode")}
              />
            }
            isLast
          />
        </SettingsCard>
      </section>

      {/* Notifications & data */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionNotifData")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Bell}
            bubble="bg-warning/12 text-warning"
            title={t("profile.notifSettings")}
            subtitle={t("profile.notifSettingsSub")}
            onClick={() => navigate("/notifications/settings")}
          />
          <SettingRow
            icon={Calendar}
            bubble="bg-info/12 text-info"
            title={t("profile.notifCentre")}
            subtitle={t("profile.notifCentreSub")}
            onClick={() => navigate("/notifications")}
          />
          <SettingRow
            icon={Download}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title={t("profile.exportData")}
            subtitle={t("profile.exportDataSub")}
            onClick={handleExport}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Legal */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionLegal")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Shield}
            bubble="bg-slate-500/12 text-slate-600 dark:text-slate-400"
            title={t("profile.privacyPolicy")}
            onClick={() => setLegalDoc("privacy")}
          />
          <SettingRow
            icon={FileText}
            bubble="bg-slate-500/12 text-slate-600 dark:text-slate-400"
            title={t("profile.terms")}
            onClick={() => setLegalDoc("terms")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Account actions */}
      <section className="px-4 pt-6">
        <SectionTitle>{t("profile.sectionActions")}</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={LogOut}
            bubble="bg-muted text-muted-foreground"
            title={t("profile.logOut")}
            onClick={() => {
              signOut();
              toast.success(t("profile.signedOut"));
              navigate("/signin");
            }}
          />
          <SettingRow
            icon={Trash2}
            bubble="bg-destructive/12 text-destructive"
            title={t("profile.deleteAccount")}
            subtitle={t("profile.deleteAccountSub")}
            danger
            onClick={() => setConfirmDelete(true)}
            isLast
          />
        </SettingsCard>
        <p className="pb-6 pt-6 text-center text-[12px] text-muted-foreground">
          {t("profile.footer", { version: APP_VERSION })}
        </p>
      </section>

      {/* ---------------- Sheets ---------------- */}

      <EditProfileSheet open={sheet === "edit"} onOpenChange={closeSheet} />
      <ChangePasswordSheet open={sheet === "password"} onOpenChange={closeSheet} />
      <ActiveSessionsSheet open={sheet === "sessions"} onOpenChange={closeSheet} />
      <SupportSheet kind="contact" open={sheet === "contact"} onOpenChange={closeSheet} />
      <SupportSheet kind="bug" open={sheet === "bug"} onOpenChange={closeSheet} />
      <SupportSheet kind="feature" open={sheet === "feature"} onOpenChange={closeSheet} />
      <FaqSheet open={sheet === "faq"} onOpenChange={closeSheet} />
      <WhatsNewSheet open={sheet === "whatsNew"} onOpenChange={closeSheet} />
      <RateAppSheet open={sheet === "rate"} onOpenChange={closeSheet} />
      <ShareAppSheet open={sheet === "share"} onOpenChange={closeSheet} />
      <BudgetSheet open={budgetOpen} onOpenChange={setBudgetOpen} />

      {/* Delete confirm — requires the current password */}
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (open) {
            setDeletePassword("");
            setDeleteError(null);
            setDeleting(false);
          }
        }}
      >
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profile.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteRequiresPassword && (
            <div className="space-y-1.5">
              <label className="text-[13px] font-bold text-foreground" htmlFor="delete-password">
                {t("profile.deletePasswordLabel")}
              </label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                placeholder={t("profile.deletePasswordPlaceholder")}
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value);
                  setDeleteError(null);
                }}
                className="h-11 rounded-xl"
                disabled={deleting}
              />
              {deleteError && (
                <p className="text-[12px] font-bold text-destructive" role="alert">
                  {deleteError}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{t("profile.keepAccount")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => void handleConfirmDelete(e)}
              disabled={deleting || (deleteRequiresPassword && deletePassword.length === 0)}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("profile.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Legal bottom sheet */}
      <FormSheet
        open={legalDoc !== null}
        onOpenChange={(open) => !open && setLegalDoc(null)}
        title={legalDoc === "privacy" ? t("profile.privacyPolicy") : t("profile.terms")}
        description={t("profile.legalUpdated")}
      >
        <div className="space-y-4 text-[13px] leading-relaxed text-muted-foreground">
          {legalDoc === "privacy" ? (
            <>
              <p>{t("profile.privacyP1")}</p>
              <p>{t("profile.privacyP2")}</p>
              <p>{t("profile.privacyP3")}</p>
            </>
          ) : (
            <>
              <p>{t("profile.termsP1")}</p>
              <p>{t("profile.termsP2")}</p>
            </>
          )}
        </div>
      </FormSheet>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-[15px] font-extrabold tabular">{value}</p>
      <p className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white/55">{label}</p>
    </div>
  );
}
