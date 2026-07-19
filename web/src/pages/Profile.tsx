import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  LifeBuoy,
  LogOut,
  Mail,
  MessageSquarePlus,
  Moon,
  PiggyBank,
  Share2,
  Shield,
  ShieldCheck,
  Smartphone,
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
import { FormSheet } from "@/components/lifevault/FormSheet";
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
import { useApp } from "@/context/AppContext";
import { initials } from "@/lib/format";
import { CURRENCIES } from "@/lib/types";
import { cn } from "@/lib/utils";

const APP_VERSION = "1.0.0";

/**
 * Budget input with currency prefix rendered outside the editable field and
 * leading-zero-replacement behavior (typing 5 over an initial 0 yields 5, not 05).
 */
function BudgetInput({
  value,
  currency,
  onChange,
}: {
  value: number;
  currency: string;
  onChange: (next: number) => void;
}) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const [draft, setDraft] = useState<string>(() => (value ? String(value) : ""));
  const hasFocusRef = useRef<boolean>(false);

  useEffect(() => {
    if (!hasFocusRef.current) {
      setDraft(value ? String(value) : "");
    }
  }, [value]);

  const commit = (next: number) => onChange(Math.max(0, Number.isFinite(next) ? next : 0));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    let cleaned = raw.replace(/[^0-9.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`;
    }
    if (cleaned === "") {
      setDraft("");
      commit(0);
      return;
    }
    // Replace a lone leading zero before a new digit: "0" + "5" -> "5"
    if (/^0\d/.test(cleaned)) {
      cleaned = cleaned.replace(/^0+/, "");
    }
    setDraft(cleaned);
    commit(Number(cleaned) || 0);
  };

  const handleFocus = () => {
    hasFocusRef.current = true;
  };

  const handleBlur = (e: React.ChangeEvent<HTMLInputElement>) => {
    hasFocusRef.current = false;
    const n = Number(e.target.value) || 0;
    setDraft(n ? String(n) : "");
    commit(n);
  };

  return (
    <div className="flex h-9 w-[124px] items-center gap-1.5 rounded-lg bg-secondary/60 px-2.5">
      <span className="shrink-0 select-none text-[13px] font-bold text-muted-foreground">{symbol}</span>
      <Input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="0"
        className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-[13px] font-bold tabular shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        aria-label="Monthly budget"
      />
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  AUD: "A$",
  USD: "$",
  EUR: "€",
  GBP: "£",
  NZD: "NZ$",
  CAD: "C$",
};

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
      <span className="min-w-0 flex-1 text-left">
        <span className={cn("block text-[14px] font-bold", danger && "text-destructive")}>{title}</span>
        {subtitle && <span className="block text-[12px] text-muted-foreground">{subtitle}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null)}
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
    settings,
    updateSettings,
    signOut,
    deleteAccount,
    documents,
    expenses,
    subscriptions,
    appointments,
    sessions,
  } = useApp();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [legalDoc, setLegalDoc] = useState<"privacy" | "terms" | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);

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
    toast.success("Your data has been exported");
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
        title="Profile"
        subtitle="Account & settings"
        actions={
          <button
            type="button"
            onClick={() => openSheet("edit")}
            aria-label="Edit profile"
            className="flex h-10 items-center gap-1.5 rounded-full bg-secondary/70 px-3.5 text-[13px] font-bold text-secondary-foreground transition-colors hover:bg-secondary active:scale-95"
          >
            <UserCog className="h-4 w-4" /> Edit
          </button>
        }
      />

      {/* Profile hero card */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-5 text-white shadow-lg shadow-primary/15">
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
                  <Shield className="h-3 w-3" /> Vault secured
                </span>
                {user?.emailVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/25 px-2.5 py-0.5 text-[11px] font-bold text-white">
                    <ShieldCheck className="h-3 w-3" /> Verified
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
            <Stat label="Documents" value={documents.length} />
            <Stat label="Sessions" value={activeSessionsCount} />
            <Stat
              label="Member since"
              value={
                user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-AU", { month: "short", year: "2-digit" })
                  : "—"
              }
            />
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="px-4 pt-6">
        <SectionTitle>Account</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={KeyRound}
            bubble="bg-warning/12 text-warning"
            title="Change password"
            onClick={() => openSheet("password")}
          />
          <SettingRow
            icon={Cloud}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title="Backup & Sync"
            subtitle="Secure encrypted cloud backup"
            onClick={() => navigate("/backup")}
          />
          <SettingRow
            icon={Shield}
            bubble="bg-info/12 text-info"
            title="Security"
            subtitle="Face ID, PIN, auto-lock & privacy"
            onClick={() => navigate("/security")}
          />
          <SettingRow
            icon={Smartphone}
            bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            title="Active sessions"
            subtitle={`${activeSessionsCount} device${activeSessionsCount === 1 ? "" : "s"} signed in`}
            onClick={() => openSheet("sessions")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Support */}
      <section className="px-4 pt-6">
        <SectionTitle>Support</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={LifeBuoy}
            bubble="bg-success/12 text-success"
            title="Contact support"
            subtitle="We reply within 24 hours"
            onClick={() => openSheet("contact")}
          />
          <SettingRow
            icon={Bug}
            bubble="bg-destructive/12 text-destructive"
            title="Report a bug"
            onClick={() => openSheet("bug")}
          />
          <SettingRow
            icon={MessageSquarePlus}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title="Request a feature"
            onClick={() => openSheet("feature")}
          />
          <SettingRow
            icon={HelpCircle}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title="FAQ"
            onClick={() => openSheet("faq")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* App */}
      <section className="px-4 pt-6">
        <SectionTitle>App</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Info}
            bubble="bg-muted text-muted-foreground"
            title="App version"
            right={<span className="text-[13px] font-bold text-muted-foreground">v{APP_VERSION}</span>}
          />
          <SettingRow
            icon={Sparkles}
            bubble="bg-warning/12 text-warning"
            title="What's new"
            onClick={() => openSheet("whatsNew")}
          />
          <SettingRow
            icon={Star}
            bubble="bg-amber-500/12 text-amber-600 dark:text-amber-400"
            title="Rate the app"
            onClick={() => openSheet("rate")}
          />
          <SettingRow
            icon={Share2}
            bubble="bg-info/12 text-info"
            title="Share the app"
            onClick={handleShare}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Preferences */}
      <section className="px-4 pt-6">
        <SectionTitle>Preferences</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={CircleDollarSign}
            bubble="bg-success/12 text-success"
            title="Currency"
            subtitle="Used across the app"
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
            title="Monthly budget"
            subtitle={`Currently ${settings.currency}`}
            right={
              <BudgetInput
                value={settings.monthlyBudget}
                currency={settings.currency}
                onChange={(monthlyBudget) => updateSettings({ monthlyBudget })}
              />
            }
          />
          <SettingRow
            icon={Moon}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title="Dark mode"
            right={
              <Switch
                checked={settings.darkMode}
                onCheckedChange={(darkMode) => updateSettings({ darkMode })}
                aria-label="Toggle dark mode"
              />
            }
            isLast
          />
        </SettingsCard>
      </section>

      {/* Notifications & data */}
      <section className="px-4 pt-6">
        <SectionTitle>Notifications & data</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Bell}
            bubble="bg-warning/12 text-warning"
            title="Notification settings"
            subtitle="Choose which reminders you get"
            onClick={() => navigate("/notifications/settings")}
          />
          <SettingRow
            icon={Calendar}
            bubble="bg-info/12 text-info"
            title="Notification centre"
            subtitle="View all recent reminders"
            onClick={() => navigate("/notifications")}
          />
          <SettingRow
            icon={Download}
            bubble="bg-sky-500/12 text-sky-600 dark:text-sky-400"
            title="Export my data"
            subtitle="Download everything as JSON"
            onClick={handleExport}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Legal */}
      <section className="px-4 pt-6">
        <SectionTitle>Legal</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Shield}
            bubble="bg-slate-500/12 text-slate-600 dark:text-slate-400"
            title="Privacy policy"
            onClick={() => setLegalDoc("privacy")}
          />
          <SettingRow
            icon={FileText}
            bubble="bg-slate-500/12 text-slate-600 dark:text-slate-400"
            title="Terms & conditions"
            onClick={() => setLegalDoc("terms")}
            isLast
          />
        </SettingsCard>
      </section>

      {/* Account actions */}
      <section className="px-4 pt-6">
        <SectionTitle>Account actions</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={LogOut}
            bubble="bg-muted text-muted-foreground"
            title="Log out"
            onClick={() => {
              signOut();
              toast.success("Signed out");
              navigate("/signin");
            }}
          />
          <SettingRow
            icon={Trash2}
            bubble="bg-destructive/12 text-destructive"
            title="Delete account"
            subtitle="Permanently erase all data"
            danger
            onClick={() => setConfirmDelete(true)}
            isLast
          />
        </SettingsCard>
        <p className="pb-6 pt-6 text-center text-[12px] text-muted-foreground">
          LifeVault v{APP_VERSION} · Made with care
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

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              All documents, expenses, subscriptions and appointments will be permanently erased. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep account</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteAccount();
                toast.success("Account deleted");
                navigate("/onboarding");
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Legal bottom sheet */}
      <FormSheet
        open={legalDoc !== null}
        onOpenChange={(open) => !open && setLegalDoc(null)}
        title={legalDoc === "privacy" ? "Privacy Policy" : "Terms & Conditions"}
        description="Last updated July 2026"
      >
        <div className="space-y-4 text-[13px] leading-relaxed text-muted-foreground">
          {legalDoc === "privacy" ? (
            <>
              <p>
                LifeVault stores your documents, expenses and appointments locally on your device. We never sell
                your personal information or share it with third parties.
              </p>
              <p>
                Data you export belongs entirely to you. Biometric authentication is handled by your device and
                never leaves it.
              </p>
              <p>You may delete your account and all associated data at any time from Settings.</p>
            </>
          ) : (
            <>
              <p>
                By using LifeVault you agree to use the app for personal, lawful purposes. LifeVault provides
                reminders as a convenience and is not responsible for missed renewals or expired documents.
              </p>
              <p>
                The app is provided "as is" without warranty of any kind. Always verify important dates with the
                issuing authority.
              </p>
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
