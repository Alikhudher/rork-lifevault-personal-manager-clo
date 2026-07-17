import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Lightbulb,
  Loader2,
  Mail,
  Monitor,
  Smartphone,
  Star,
  Tablet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { FormSheet, Field } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";
import { initials } from "@/lib/format";
import type { DeviceSession } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deviceIcon(device: string) {
  if (/iphone/i.test(device)) return Smartphone;
  if (/ipad/i.test(device)) return Tablet;
  return Monitor;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Edit Profile Sheet                                                  */
/* ------------------------------------------------------------------ */

type EditStep = "form" | "verify";

export function EditProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, updateUser, verifyEmail } = useApp();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [step, setStep] = useState<EditStep>("form");
  const [code, setCode] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [resendIn, setResendIn] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync form state whenever the sheet opens.
  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPhoto(user?.photo ?? null);
      setStep("form");
      setCode("");
      setResendIn(0);
    }
  }, [open, user]);

  // Resend countdown ticker.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const emailChanged = useMemo(
    () => email.trim().toLowerCase() !== (user?.email ?? "").toLowerCase(),
    [email, user?.email],
  );

  const handlePhotoPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Photo must be under 4 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const sendCode = useCallback(() => {
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setResendIn(30);
      toast.success("Verification code sent", { description: `Check ${email.trim()} for a 6-digit code.` });
    }, 900);
  }, [email]);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      toast.error("Enter a valid email address");
      return;
    }
    if (emailChanged) {
      setStep("verify");
      sendCode();
      return;
    }
    // No email change — save directly.
    updateUser({ name: name.trim(), photo });
    toast.success("Profile updated");
    onOpenChange(false);
  };

  const handleVerify = () => {
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    // Mock: any 6-digit code is accepted.
    updateUser({ name: name.trim(), email: email.trim().toLowerCase(), photo, emailVerified: true });
    verifyEmail();
    toast.success("Email verified & profile saved");
    onOpenChange(false);
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={step === "form" ? "Edit profile" : "Verify email"}
      description={
        step === "form"
          ? "Update your photo, name and email."
          : `We sent a 6-digit code to ${email.trim()}.`
      }
    >
      {step === "form" ? (
        <div className="space-y-5">
          {/* Photo picker */}
          <div className="flex flex-col items-center gap-3 pb-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative flex h-24 w-24 items-center justify-center rounded-full bg-secondary ring-2 ring-border transition-transform active:scale-95"
              aria-label="Change profile photo"
            >
              {photo ? (
                <Avatar className="h-24 w-24 rounded-full">
                  <AvatarImage src={photo} alt={name || "Profile"} />
                  <AvatarFallback className="rounded-full bg-primary text-[22px] font-extrabold text-primary-foreground">
                    {initials(name || "You")}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <span className="text-[24px] font-extrabold text-primary">
                  {initials(name || "You")}
                </span>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform group-hover:scale-105">
                <Camera className="h-[18px] w-[18px]" />
              </span>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[13px] font-bold text-primary dark:text-foreground"
              >
                Upload photo
              </button>
              {photo && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setPhoto(null)}
                    className="text-[13px] font-bold text-destructive"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoPick}
            />
          </div>

          <Field label="Full name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-12 rounded-xl"
              autoComplete="name"
            />
          </Field>

          <Field
            label="Email address"
            hint={emailChanged ? "You'll need to verify the new email before saving." : undefined}
          >
            <div className="relative">
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-xl pr-10"
                autoComplete="email"
              />
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            </div>
          </Field>

          <div className="rounded-xl bg-secondary/60 px-4 py-3">
            <p className="text-[12px] font-bold text-muted-foreground">Account created</p>
            <p className="text-[13px] font-bold text-foreground">
              {user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>

          <Button
            type="button"
            size="lg"
            onClick={handleSave}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            {emailChanged ? "Continue to verify" : "Save changes"}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-1 pb-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-info/12 text-info">
              <Mail className="h-6 w-6" />
            </span>
            <p className="text-[13px] text-muted-foreground">
              Enter the code we sent to <span className="font-bold text-foreground">{email.trim()}</span>
            </p>
          </div>

          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              containerClassName="gap-1.5"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
                <InputOTPSlot index={1} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
                <InputOTPSlot index={2} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
                <InputOTPSlot index={4} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
                <InputOTPSlot index={5} className="h-12 w-12 rounded-lg text-[16px] font-bold" />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-[13px]">
            {resendIn > 0 ? (
              <span className="text-muted-foreground">Resend code in {resendIn}s</span>
            ) : (
              <button
                type="button"
                onClick={sendCode}
                disabled={sending}
                className="font-bold text-primary dark:text-foreground"
              >
                {sending ? "Sending…" : "Resend code"}
              </button>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setStep("form")}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold"
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={handleVerify}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              Verify & save
            </Button>
          </div>
        </div>
      )}
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Change Password Sheet                                               */
/* ------------------------------------------------------------------ */

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  const colors = [
    "bg-muted",
    "bg-destructive",
    "bg-warning",
    "bg-info",
    "bg-success",
  ];
  return { score, label: labels[score], color: colors[score] };
}

export function ChangePasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, changePassword } = useApp();
  const [current, setCurrent] = useState<string>("");
  const [next, setNext] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [showCurrent, setShowCurrent] = useState<boolean>(false);
  const [showNext, setShowNext] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowCurrent(false);
      setShowNext(false);
      setSaving(false);
    }
  }, [open]);

  const strength = useMemo(() => passwordStrength(next), [next]);
  const hasPassword = user?.password !== null;
  const canSave =
    (hasPassword ? current.length > 0 : true) &&
    next.length >= 6 &&
    next === confirm;

  const handleSubmit = () => {
    if (!canSave) {
      if (hasPassword && !current) {
        toast.error("Enter your current password");
        return;
      }
      if (next.length < 6) {
        toast.error("New password must be at least 6 characters");
        return;
      }
      if (next !== confirm) {
        toast.error("Passwords do not match");
        return;
      }
      return;
    }
    setSaving(true);
    window.setTimeout(() => {
      const ok = changePassword(current, next);
      setSaving(false);
      if (!ok) {
        toast.error("Current password is incorrect");
        return;
      }
      toast.success("Password changed successfully");
      onOpenChange(false);
    }, 700);
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Change password"
      description={hasPassword ? "Enter your current password to set a new one." : "Set a password for your account."}
    >
      <div className="space-y-5">
        {hasPassword && (
          <Field label="Current password">
            <PasswordInput
              value={current}
              onChange={setCurrent}
              show={showCurrent}
              onToggle={() => setShowCurrent((v) => !v)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
        )}

        <Field label="New password">
          <PasswordInput
            value={next}
            onChange={setNext}
            show={showNext}
            onToggle={() => setShowNext((v) => !v)}
            placeholder="At least 6 characters"
            autoComplete="new-password"
          />
          {next.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      i < strength.score ? strength.color : "bg-muted",
                    )}
                  />
                ))}
              </div>
              <p className="text-[12px] font-bold text-muted-foreground">{strength.label}</p>
            </div>
          )}
        </Field>

        <Field label="Confirm new password">
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            show={showNext}
            onToggle={() => setShowNext((v) => !v)}
            placeholder="Re-enter new password"
            autoComplete="new-password"
          />
          {confirm.length > 0 && next === confirm && (
            <p className="flex items-center gap-1 text-[12px] font-bold text-success">
              <Check className="h-3.5 w-3.5" /> Passwords match
            </p>
          )}
        </Field>

        <Button
          type="button"
          size="lg"
          disabled={!canSave || saving}
          onClick={handleSubmit}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </div>
    </FormSheet>
  );
}

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 rounded-xl pr-11"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      >
        {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Active Sessions Sheet                                               */
/* ------------------------------------------------------------------ */

export function ActiveSessionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { sessions, revokeSession, signOutAllDevices } = useApp();
  const [confirmAll, setConfirmAll] = useState<boolean>(false);

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Active sessions"
      description="Devices currently signed in to your account."
    >
      <div className="space-y-2.5">
        {sessions.length === 0 && (
          <p className="py-8 text-center text-[14px] text-muted-foreground">No active sessions.</p>
        )}
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            onRevoke={() => {
              revokeSession(session.id);
              toast.success("Session signed out");
            }}
          />
        ))}

        {sessions.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => setConfirmAll(true)}
            className="mt-4 h-[52px] w-full rounded-2xl text-[15px] font-bold text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            Sign out of all devices
          </Button>
        )}
      </div>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll be signed out of all devices including this one. You'll need to sign back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                signOutAllDevices();
                toast.success("Signed out of all devices");
                onOpenChange(false);
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sign out all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSheet>
  );
}

function SessionRow({ session, onRevoke }: { session: DeviceSession; onRevoke: () => void }) {
  const Icon = deviceIcon(session.device);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-foreground ring-1 ring-border">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-bold">{session.device}</p>
          {session.current && (
            <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-success">
              This device
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{session.location}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatDistanceToNow(parseISO(session.lastActive), { addSuffix: true })}
        </p>
      </div>
      {!session.current && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label="Revoke session"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Support Sheets                                                      */
/* ------------------------------------------------------------------ */

type SupportKind = "contact" | "bug" | "feature";

const SUPPORT_META: Record<
  SupportKind,
  { title: string; description: string; cta: string; placeholder: string; subjectLabel: string }
> = {
  contact: {
    title: "Contact support",
    description: "We typically reply within 24 hours.",
    cta: "Send message",
    placeholder: "How can we help?",
    subjectLabel: "Subject",
  },
  bug: {
    title: "Report a bug",
    description: "Tell us what went wrong and we'll fix it.",
    cta: "Submit report",
    placeholder: "What happened? What steps did you take?",
    subjectLabel: "Bug summary",
  },
  feature: {
    title: "Request a feature",
    description: "Have an idea? We'd love to hear it.",
    cta: "Submit request",
    placeholder: "What would you like LifeVault to do?",
    subjectLabel: "Feature idea",
  },
};

export function SupportSheet({
  kind,
  open,
  onOpenChange,
}: {
  kind: SupportKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = SUPPORT_META[kind];
  const { user } = useApp();
  const [subject, setSubject] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setSubject("");
      setMessage("");
      setSending(false);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!subject.trim()) {
      toast.error("Add a subject");
      return;
    }
    if (message.trim().length < 10) {
      toast.error("Please add a bit more detail");
      return;
    }
    setSending(true);
    // Blur the active field before submitting so iOS doesn't refocus/zoom
    // when the sheet closes and the toast appears.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.setTimeout(() => {
      setSending(false);
      toast.success(`${meta.title} submitted`, {
        description: `Thanks${user?.name ? `, ${user.name.split(" ")[0]}` : ""}! We'll be in touch.`,
      });
      onOpenChange(false);
    }, 800);
  };

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={meta.title} description={meta.description}>
      <div className="space-y-5">
        <Field label={meta.subjectLabel}>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={meta.subjectLabel}
            className="h-12 rounded-xl"
          />
        </Field>
        <Field label="Message">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={meta.placeholder}
            className="min-h-[120px] rounded-xl"
          />
        </Field>
        <Button
          type="button"
          size="lg"
          disabled={sending}
          onClick={handleSubmit}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            meta.cta
          )}
        </Button>
      </div>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ Sheet                                                           */
/* ------------------------------------------------------------------ */

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is my data secure?",
    a: "LifeVault stores your documents and data locally on your device. Biometric authentication is handled by your device and never leaves it. You can export or delete your data at any time.",
  },
  {
    q: "How do reminders work?",
    a: "You can set reminders 7, 14, 30, 60 or 90 days before a document expires, a subscription renews, or an appointment is coming up. Reminders appear in your notification centre.",
  },
  {
    q: "Can I change my currency?",
    a: "Yes. Go to Profile → Currency and pick from AUD, USD, EUR, GBP, NZD or CAD. The default is Australian Dollar (AUD).",
  },
  {
    q: "How do I add a document?",
    a: "Tap the Documents tab, then the add button. You can upload a PDF, image or document, choose a category, set issue and expiry dates, and choose when to be reminded.",
  },
  {
    q: "How do I set a monthly budget?",
    a: "Go to Profile → Monthly budget and enter your limit. The home dashboard and expenses screen will track your progress against it.",
  },
  {
    q: "What happens when I delete my account?",
    a: "All documents, expenses, subscriptions and appointments are permanently erased from this device. This action cannot be undone.",
  },
];

export function FaqSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="FAQ" description="Frequently asked questions.">
      <Accordion type="single" collapsible className="space-y-2">
        {FAQ_ITEMS.map((item, i) => (
          <AccordionItem
            key={i}
            value={`item-${i}`}
            className="rounded-2xl border border-border/70 bg-secondary/40 px-4 [&[data-state=open]]:bg-secondary/70"
          >
            <AccordionTrigger className="text-left text-[14px] font-bold hover:no-underline">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-[13px] leading-relaxed text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* What's New Sheet                                                    */
/* ------------------------------------------------------------------ */

const WHATS_NEW: { version: string; date: string; changes: string[] }[] = [
  {
    version: "1.0",
    date: "Jul 2026",
    changes: [
      "Brand new Account section with edit profile, security and support.",
      "Email verification flow when changing your email address.",
      "Active sessions — see and revoke signed-in devices.",
      "Change password with strength indicator.",
      "FAQ, What's New, rate and share the app.",
    ],
  },
];

export function WhatsNewSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="What's new" description="The latest improvements to LifeVault.">
      <div className="space-y-4">
        {WHATS_NEW.map((release) => (
          <div key={release.version} className="rounded-2xl bg-secondary/50 p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-extrabold text-primary dark:text-foreground">
                v{release.version}
              </span>
              <span className="text-[12px] text-muted-foreground">{release.date}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {release.changes.map((change, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Rate the App Sheet                                                  */
/* ------------------------------------------------------------------ */

export function RateAppSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rating, setRating] = useState<number>(0);
  const [submitted, setSubmitted] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setRating(0);
      setSubmitted(false);
    }
  }, [open]);

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Rate LifeVault" description="Enjoying the app? Let us know.">
      {submitted ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/12 text-success">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <p className="text-[16px] font-extrabold">Thank you!</p>
          <p className="text-[13px] text-muted-foreground">Your feedback helps us improve LifeVault.</p>
          <Button
            type="button"
            size="lg"
            onClick={() => onOpenChange(false)}
            className="mt-2 h-[48px] rounded-2xl px-8 text-[14px] font-bold"
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 py-4">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
                className="transition-transform active:scale-90"
              >
                <Star
                  className={cn(
                    "h-9 w-9 transition-colors",
                    star <= rating ? "fill-warning text-warning" : "text-muted-foreground/40",
                  )}
                />
              </button>
            ))}
          </div>
          <p className="text-[14px] font-bold text-muted-foreground">
            {rating === 0 ? "Tap a star to rate" : rating >= 4 ? "Thanks for the love!" : "We'll do better!"}
          </p>
          <Button
            type="button"
            size="lg"
            disabled={rating === 0}
            onClick={() => setSubmitted(true)}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            Submit rating
          </Button>
        </div>
      )}
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Share the App Sheet                                                 */
/* ------------------------------------------------------------------ */

export function ShareAppSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shareUrl = "https://lifevault.app";
  const shareText = "Check out LifeVault — one secure place for your documents, payments and appointments.";

  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl).then(
      () => toast.success("Link copied to clipboard"),
      () => toast.error("Couldn't copy link"),
    );
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "LifeVault", text: shareText, url: shareUrl });
      } catch {
        // user cancelled — no toast
      }
    } else {
      copyLink();
    }
  };

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Share LifeVault" description="Spread the word about LifeVault.">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-4">
          <Lightbulb className="h-5 w-5 shrink-0 text-warning" />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Know someone who forgets renewal dates? Share LifeVault with them.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted-foreground">{shareUrl}</span>
          <Button type="button" variant="secondary" size="sm" onClick={copyLink} className="rounded-xl font-bold">
            Copy
          </Button>
        </div>

        <Button
          type="button"
          size="lg"
          onClick={nativeShare}
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          Share via…
        </Button>
      </div>
    </FormSheet>
  );
}
