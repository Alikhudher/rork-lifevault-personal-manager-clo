import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Loader2,
  Mail,
  Monitor,
  ShieldCheck,
  Smartphone,
  Star,
  Tablet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, parseISO } from "date-fns";
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
import { PhotoPicker } from "@/components/lifevault/PhotoPicker";
import { accountHasPassword, useApp } from "@/context/AppContext";
import {
  alignCloudPasswordAfterReset,
  finishVerifiedSession,
  requestEmailCode,
  verifyEmailCode,
  type VerifiedEmailSession,
} from "@/lib/account-recovery";
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

type EditStep = "form" | "password" | "verify";

export function EditProfileSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, updateUser, accounts, verifyAccountPassword } = useApp();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [step, setStep] = useState<EditStep>("form");
  const [code, setCode] = useState<string>("");
  const [currentPw, setCurrentPw] = useState<string>("");
  const [showCurrentPw, setShowCurrentPw] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState<number>(0);

  // Sync form state whenever the sheet opens.
  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPhoto(user?.photo ?? null);
      setStep("form");
      setCode("");
      setCurrentPw("");
      setShowCurrentPw(false);
      setBusy(false);
      setError(null);
      setResendIn(0);
    }
  }, [open, user]);

  // Resend countdown ticker.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const normalizedEmail = email.trim().toLowerCase();

  const emailChanged = useMemo(
    () => normalizedEmail !== (user?.email ?? "").toLowerCase(),
    [normalizedEmail, user?.email],
  );

  /** True if the chosen email is already used by another account. */
  const emailTaken = useMemo(() => {
    if (!normalizedEmail) return false;
    return accounts.some(
      (a) => a.email.toLowerCase() === normalizedEmail && a.email.toLowerCase() !== (user?.email ?? "").toLowerCase(),
    );
  }, [normalizedEmail, accounts, user?.email]);

  /** Whether the signed-in account has a password to verify. */
  const requiresPassword = useMemo(() => {
    const account = accounts.find(
      (a) => a.email.toLowerCase() === (user?.email ?? "").toLowerCase(),
    );
    return accountHasPassword(account);
  }, [accounts, user?.email]);

  /** Send a REAL 6-digit code to the new address via the auth server. */
  const sendCode = useCallback(async (): Promise<boolean> => {
    const result = await requestEmailCode(normalizedEmail);
    if (result.ok === false) {
      setError(result.error);
      toast.error(result.error);
      return false;
    }
    setCode("");
    setResendIn(60);
    toast.success("Verification code sent", {
      description: `Check ${normalizedEmail} (and Spam) for a 6-digit code.`,
    });
    return true;
  }, [normalizedEmail]);

  const handleSave = () => {
    setError(null);
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      toast.error("Enter a valid email address");
      return;
    }
    if (emailTaken) {
      toast.error("That email is already linked to another account");
      return;
    }
    if (emailChanged) {
      // Changing the email is a sensitive action: the current password
      // is verified first, then ownership of the NEW address is proven
      // with a real emailed code — nothing is accepted blindly.
      if (requiresPassword) {
        setStep("password");
        return;
      }
      setBusy(true);
      void sendCode()
        .then((sent) => {
          if (sent) setStep("verify");
        })
        .finally(() => setBusy(false));
      return;
    }
    // No email change — save directly.
    updateUser({ name: name.trim(), photo });
    toast.success("Profile updated");
    onOpenChange(false);
  };

  const handlePasswordContinue = async () => {
    if (busy) return;
    setError(null);
    if (!currentPw) {
      setError("Enter your current password.");
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyAccountPassword(currentPw);
      if (!ok) {
        setError("Current password is incorrect.");
        return;
      }
      const sent = await sendCode();
      if (sent) setStep("verify");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (busy) return;
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      // Server-side check — a wrong or expired code is always rejected.
      const result = await verifyEmailCode(normalizedEmail, code);
      if (result.ok === false) {
        setError(result.error);
        setCode("");
        return;
      }
      await finishVerifiedSession(result.session);
      updateUser({ name: name.trim(), email: normalizedEmail, photo, emailVerified: true });
      toast.success("Email verified & profile saved");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error ? (
    <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 ring-1 ring-destructive/25" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="text-[12.5px] font-semibold leading-relaxed text-destructive">{error}</p>
    </div>
  ) : null;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        step === "form" ? "Edit profile" : step === "password" ? "Confirm your password" : "Verify email"
      }
      description={
        step === "form"
          ? "Update your photo, name and email."
          : step === "password"
            ? "Changing your email requires your current password."
            : `We sent a 6-digit code to ${normalizedEmail}.`
      }
    >
      {step === "form" && (
        <div className="space-y-5">
          {/* Photo picker — uses @capacitor/camera on native (real permission
              prompts + native picker) and a hidden file input on the web. */}
          <PhotoPicker value={photo} onChange={setPhoto} name={name} />

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
            hint={
              emailTaken
                ? "That email is already linked to another account."
                : emailChanged
                  ? "You'll need to verify the new email before saving."
                  : undefined
            }
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

          {errorBox}

          <Button
            type="button"
            size="lg"
            onClick={handleSave}
            disabled={busy}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending code…
              </>
            ) : emailChanged ? (
              "Continue to verify"
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      )}

      {step === "password" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-1 pb-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/12 text-warning">
              <KeyRound className="h-6 w-6" />
            </span>
            <p className="text-[13px] text-muted-foreground">
              Confirm it&apos;s you before changing the email to{" "}
              <span className="font-bold text-foreground">{normalizedEmail}</span>
            </p>
          </div>

          <Field label="Current password">
            <PasswordInput
              value={currentPw}
              onChange={setCurrentPw}
              show={showCurrentPw}
              onToggle={() => setShowCurrentPw((v) => !v)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          {errorBox}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStep("form");
                setError(null);
                setCurrentPw("");
              }}
              disabled={busy}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold"
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void handlePasswordContinue()}
              disabled={busy}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </div>
      )}

      {step === "verify" && (
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
                onClick={() => {
                  setBusy(true);
                  void sendCode().finally(() => setBusy(false));
                }}
                disabled={busy}
                className="font-bold text-primary dark:text-foreground"
              >
                {busy ? "Sending…" : "Resend code"}
              </button>
            )}
          </div>

          {errorBox}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStep("form");
                setError(null);
                setCode("");
              }}
              disabled={busy}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold"
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void handleVerify()}
              disabled={busy || code.length !== 6}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify & save"
              )}
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

type ChangePasswordStep = "form" | "recoverEmail" | "recoverCode" | "recoverPassword";

/** Instagram's link blue — used for the "Forgot password?" action. */
const LINK_BLUE_CLASS = "text-[#0095F6]";

export function ChangePasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, accounts, changePassword, resetAccountPassword } = useApp();
  const [step, setStep] = useState<ChangePasswordStep>("form");
  const [current, setCurrent] = useState<string>("");
  const [next, setNext] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [showCurrent, setShowCurrent] = useState<boolean>(false);
  const [showNext, setShowNext] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // In-app recovery ("Forgot password?") — Instagram-style: verify the
  // registered email with a real 6-digit code, set a new password, and
  // return to the Account screen WITHOUT ever logging out.
  const [recoveryEmail, setRecoveryEmail] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [resetPw, setResetPw] = useState<string>("");
  const [resetConfirm, setResetConfirm] = useState<string>("");
  const [showResetPw, setShowResetPw] = useState<boolean>(false);
  const [resendIn, setResendIn] = useState<number>(0);
  const verifiedRef = useRef<VerifiedEmailSession | null>(null);

  useEffect(() => {
    if (open) {
      setStep("form");
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowCurrent(false);
      setShowNext(false);
      setSaving(false);
      setError(null);
      setRecoveryEmail(user?.email ?? "");
      setCode("");
      setResetPw("");
      setResetConfirm("");
      setShowResetPw(false);
      setResendIn(0);
    } else {
      // Sheet dismissed mid-recovery — discard any verified email session.
      const session = verifiedRef.current;
      verifiedRef.current = null;
      if (session) void finishVerifiedSession(session);
    }
  }, [open, user?.email]);

  // Resend countdown ticker.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const strength = useMemo(() => passwordStrength(next), [next]);
  const resetStrength = useMemo(() => passwordStrength(resetPw), [resetPw]);
  /** Registry-based: true when the signed-in account has a stored credential. */
  const hasPassword = useMemo(() => {
    const account = accounts.find(
      (a) => a.email.toLowerCase() === (user?.email ?? "").toLowerCase(),
    );
    return accountHasPassword(account);
  }, [accounts, user?.email]);
  const canSave =
    (hasPassword ? current.length > 0 : true) &&
    next.length >= 6 &&
    next === confirm;

  const accountEmail = (user?.email ?? "").toLowerCase();
  const normalizedRecoveryEmail = recoveryEmail.trim().toLowerCase();

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);
    if (hasPassword && !current) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      // The current password is verified against the stored hash — a
      // wrong current password NEVER goes through.
      const ok = await changePassword(current, next);
      if (!ok) {
        setError("Current password is incorrect.");
        toast.error("Current password is incorrect.");
        return;
      }
      toast.success("Password updated", {
        description: "You stay signed in on this device — all other devices were signed out.",
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  /** Recovery step 1 — email a real 6-digit code to the registered address. */
  const sendRecoveryCode = async (isResend: boolean) => {
    if (saving) return;
    setError(null);
    if (!EMAIL_REGEX.test(normalizedRecoveryEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    // Security: while signed in, the reset code may only go to THIS
    // account's registered email — never an arbitrary address.
    if (normalizedRecoveryEmail !== accountEmail) {
      setError(`For your security, the code can only be sent to this account's email (${user?.email ?? ""}).`);
      return;
    }
    setSaving(true);
    try {
      const result = await requestEmailCode(normalizedRecoveryEmail);
      if (result.ok === false) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setCode("");
      setResendIn(60);
      setStep("recoverCode");
      toast.success(isResend ? "A new code is on its way" : "Verification code sent", {
        description: `Check ${normalizedRecoveryEmail} (and Spam) for a 6-digit code.`,
      });
    } finally {
      setSaving(false);
    }
  };

  /** Recovery step 2 — the code is checked SERVER-side, never guessed locally. */
  const verifyRecoveryCode = async () => {
    if (saving) return;
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setSaving(true);
    try {
      const result = await verifyEmailCode(normalizedRecoveryEmail, code);
      if (result.ok === false) {
        setError(result.error);
        setCode("");
        return;
      }
      verifiedRef.current = result.session;
      setStep("recoverPassword");
    } finally {
      setSaving(false);
    }
  };

  /** Recovery step 3 — set the new password; the user stays signed in. */
  const saveRecoveredPassword = async () => {
    if (saving) return;
    setError(null);
    if (resetPw.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (resetPw !== resetConfirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const ok = await resetAccountPassword(normalizedRecoveryEmail, resetPw);
      if (!ok) {
        setError("Couldn't update the password for this account. Please try again.");
        return;
      }
      // Keep the cloud identity usable (only when it has no encrypted
      // backup — an existing backup password is never touched).
      const session = verifiedRef.current;
      verifiedRef.current = null;
      if (session) {
        await alignCloudPasswordAfterReset(session, resetPw);
        await finishVerifiedSession(session);
      }
      toast.success("Password updated", {
        description: "You're still signed in on this device — all other devices were signed out.",
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const errorBox = error ? (
    <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 ring-1 ring-destructive/25" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="text-[12.5px] font-semibold leading-relaxed text-destructive">{error}</p>
    </div>
  ) : null;

  const title =
    step === "form"
      ? "Change password"
      : step === "recoverEmail"
        ? "Reset your password"
        : step === "recoverCode"
          ? "Enter the code"
          : "Create new password";
  const description =
    step === "form"
      ? hasPassword
        ? "Enter your current password to set a new one."
        : "Set a password for your account."
      : step === "recoverEmail"
        ? "Forgot your current password? Verify your email to set a new one — no logout needed."
        : step === "recoverCode"
          ? `We sent a 6-digit code to ${normalizedRecoveryEmail}.`
          : "Email verified. Choose a new password for your account.";

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {step === "form" && (
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

          {/* Instagram-style recovery entry point — blue link under the
              password fields, above the primary button. */}
          {hasPassword && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRecoveryEmail(user?.email ?? "");
                setStep("recoverEmail");
              }}
              className={cn(
                "!mt-3.5 block text-[14px] font-semibold transition-opacity active:opacity-60",
                LINK_BLUE_CLASS,
              )}
            >
              Forgot password?
            </button>
          )}

          {errorBox}

          <Button
            type="button"
            size="lg"
            disabled={!canSave || saving}
            onClick={() => void handleSubmit()}
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

          <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
            Changing your password keeps you signed in on this device and signs out all other devices.
          </p>
        </div>
      )}

      {step === "recoverEmail" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-1.5 pb-1 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0095F6]/10 text-[#0095F6]">
              <KeyRound className="h-6 w-6" />
            </span>
            <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
              We&apos;ll email you a 6-digit verification code so you can set a new password. You
              stay signed in the whole time.
            </p>
          </div>

          <Field label="Email">
            <div className="relative">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                className="h-12 rounded-xl pr-10"
                disabled={saving}
              />
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            </div>
          </Field>

          {errorBox}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              disabled={saving}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold"
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void sendRecoveryCode(false)}
              disabled={saving}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                "Send Code"
              )}
            </Button>
          </div>
        </div>
      )}

      {step === "recoverCode" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-1.5 pb-1 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-info/12 text-info">
              <Mail className="h-6 w-6" />
            </span>
            <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
              Enter the code we sent to{" "}
              <span className="font-bold text-foreground">{normalizedRecoveryEmail}</span>
            </p>
          </div>

          <div className="flex justify-center">
            <InputOTP maxLength={6} value={code} onChange={setCode} containerClassName="gap-1.5" disabled={saving}>
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
                onClick={() => void sendRecoveryCode(true)}
                disabled={saving}
                className={cn("font-bold", LINK_BLUE_CLASS)}
              >
                Resend code
              </button>
            )}
          </div>

          {errorBox}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setStep("recoverEmail");
                setError(null);
                setCode("");
              }}
              disabled={saving}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold"
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void verifyRecoveryCode()}
              disabled={saving || code.length !== 6}
              className="h-[52px] flex-1 rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify Code"
              )}
            </Button>
          </div>
        </div>
      )}

      {step === "recoverPassword" && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-1.5 pb-1 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success/12 text-success">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
              Email verified. Choose a new password for{" "}
              <span className="font-bold text-foreground">{normalizedRecoveryEmail}</span>
            </p>
          </div>

          <Field label="New password">
            <PasswordInput
              value={resetPw}
              onChange={setResetPw}
              show={showResetPw}
              onToggle={() => setShowResetPw((v) => !v)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
            {resetPw.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-colors",
                        i < resetStrength.score ? resetStrength.color : "bg-muted",
                      )}
                    />
                  ))}
                </div>
                <p className="text-[12px] font-bold text-muted-foreground">{resetStrength.label}</p>
              </div>
            )}
          </Field>

          <Field label="Confirm new password">
            <PasswordInput
              value={resetConfirm}
              onChange={setResetConfirm}
              show={showResetPw}
              onToggle={() => setShowResetPw((v) => !v)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            {resetConfirm.length > 0 && resetPw === resetConfirm && (
              <p className="flex items-center gap-1 text-[12px] font-bold text-success">
                <Check className="h-3.5 w-3.5" /> Passwords match
              </p>
            )}
          </Field>

          {errorBox}

          <Button
            type="button"
            size="lg"
            onClick={() => void saveRecoveredPassword()}
            disabled={saving || resetPw.length < 6 || resetPw !== resetConfirm}
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Reset Password"
            )}
          </Button>

          <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
            You&apos;ll stay signed in on this device — all other devices will be signed out.
          </p>
        </div>
      )}
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
    a: "Pick a preset — 1, 2, 3, 7, 14, 30, 60 or 90 days before a document expires or a subscription renews — or choose Custom and enter any number of days (1-365). Appointments can also remind you at the time of the event or 1 hour before. Reminders appear in your notification centre.",
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
    version: "1.1",
    date: "Jul 2026",
    changes: [
      "Forgot your password? Reset it right inside Change Password with an emailed code — no logout needed.",
      "Full password reset by email — verify with a 6-digit code, then set a new password.",
      "Passwords are now stored only as salted hashes, never in plain text.",
      "Current password is verified before any sensitive change — wrong passwords are always rejected.",
      "Changing your backup password now verifies the old one with the server and re-encrypts your data.",
      "Changing any password signs out all other devices automatically.",
    ],
  },
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
