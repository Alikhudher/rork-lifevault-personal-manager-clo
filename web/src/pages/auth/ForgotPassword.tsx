import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { DeliveryStatusLine } from "@/components/lifevault/DeliveryStatus";
import { Field } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";
import {
  alignCloudPasswordAfterReset,
  finishVerifiedSession,
  requestEmailCode,
  verifyEmailCode,
  type VerifiedEmailSession,
} from "@/lib/account-recovery";
import { trackEmailDelivery, type DeliveryUpdate } from "@/lib/email-delivery";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_S = 60;

type Step = "email" | "code" | "password" | "done";

/**
 * Complete password reset flow:
 *  1. Enter the account email — a real 6-digit code is emailed via
 *     Supabase Auth.
 *  2. Enter the code — verified SERVER-SIDE (wrong/expired codes are
 *     rejected by the server, never guessed client-side).
 *  3. Choose a new password — stored as a salted hash.
 *  4. Sign in with the new password.
 */
export default function ForgotPassword() {
  const { accounts, resetAccountPassword } = useApp();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [pw, setPw] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [showPw, setShowPw] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState<number>(0);
  const [delivery, setDelivery] = useState<DeliveryUpdate | null>(null);
  const verifiedRef = useRef<VerifiedEmailSession | null>(null);

  // Resend countdown ticker.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const normalizedEmail = email.trim().toLowerCase();

  const sendCode = async (isResend: boolean) => {
    if (busy) return;
    setError(null);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    const account = accounts.find((a) => a.email.toLowerCase() === normalizedEmail);
    if (!account) {
      setError("No account found with that email on this device. Check the address or create a new account.");
      return;
    }
    setBusy(true);
    try {
      const sentAt = Date.now();
      const result = await requestEmailCode(normalizedEmail);
      if (result.ok === false) {
        setError(result.error);
        toast.error(result.error);
        // The server refused a rapid repeat — sync the countdown with its
        // exact wait time so the button re-enables when a send will work.
        if (result.code === "rate_limited" && result.retryAfterS) {
          setResendIn(result.retryAfterS);
        }
        return;
      }
      setResendIn(RESEND_COOLDOWN_S);
      setCode("");
      setStep("code");
      toast.success(isResend ? "A new code is on its way" : "Verification code sent", {
        description: isResend
          ? `A fresh code was emailed to ${normalizedEmail} — the previous code no longer works.`
          : `Check ${normalizedEmail} (and Spam) for a 6-digit code.`,
      });
      // Follow the message all the way to the inbox via Brevo's logs and
      // mirror the truthful status inline next to the code input.
      setDelivery(null);
      void trackEmailDelivery(normalizedEmail, sentAt, setDelivery);
    } finally {
      setBusy(false);
    }
  };

  const checkCode = async () => {
    if (busy) return;
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    try {
      const result = await verifyEmailCode(normalizedEmail, code);
      if (result.ok === false) {
        setError(result.error);
        setCode("");
        return;
      }
      verifiedRef.current = result.session;
      setStep("password");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (busy) return;
    setError(null);
    if (pw.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const ok = await resetAccountPassword(normalizedEmail, pw);
      if (!ok) {
        setError("Couldn't update the password for this account. Please try again.");
        return;
      }
      // Keep the cloud identity usable (only when it has no encrypted
      // backup — an existing backup password is never touched).
      const session = verifiedRef.current;
      if (session) {
        await alignCloudPasswordAfterReset(session, pw);
        await finishVerifiedSession(session);
        verifiedRef.current = null;
      }
      setPw("");
      setConfirm("");
      setStep("done");
      toast.success("Password updated", { description: "Sign in with your new password." });
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
    <div className="flex min-h-dvh flex-col px-6 pt-safe">
      <Link
        to="/signin"
        className="-ml-2 mb-8 mt-3 flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-secondary"
        aria-label="Back to sign in"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>

      {step === "email" && (
        <div className="animate-fade-up">
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-foreground">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="text-[28px] font-extrabold tracking-tight">Forgot password?</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Enter your email and we&apos;ll send a 6-digit verification code.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode(false);
            }}
            className="mt-8 space-y-4"
          >
            <Field label="Email">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-xl"
                disabled={busy}
              />
            </Field>
            {errorBox}
            <Button
              type="submit"
              size="lg"
              disabled={busy}
              className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Sending code…
                </>
              ) : (
                "Send Verification Code"
              )}
            </Button>
          </form>
        </div>
      )}

      {step === "code" && (
        <div className="animate-fade-up">
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-info/12 text-info">
            <MailCheck className="h-7 w-7" />
          </span>
          <h1 className="text-[28px] font-extrabold tracking-tight">Check your inbox</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Enter the 6-digit code we sent to{" "}
            <span className="font-bold text-foreground">{normalizedEmail}</span>. It expires in 10
            minutes — only the newest code works.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode} containerClassName="gap-1.5" disabled={busy}>
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
                  onClick={() => void sendCode(true)}
                  disabled={busy}
                  className="font-bold text-primary dark:text-foreground"
                >
                  Resend code
                </button>
              )}
            </div>

            <DeliveryStatusLine state={delivery} />

            {errorBox}

            <Button
              type="button"
              size="lg"
              onClick={() => void checkCode()}
              disabled={busy || code.length !== 6}
              className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify Code"
              )}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
                setCode("");
              }}
              className="w-full text-center text-[13px] font-bold text-muted-foreground"
            >
              Use a different email
            </button>
          </div>
        </div>
      )}

      {step === "password" && (
        <div className="animate-fade-up">
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/12 text-success">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h1 className="text-[28px] font-extrabold tracking-tight">Create a new password</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Your email is verified. Choose a new password for{" "}
            <span className="font-bold text-foreground">{normalizedEmail}</span>.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void savePassword();
            }}
            className="mt-8 space-y-4"
          >
            <Field label="New password" hint="At least 6 characters.">
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="h-12 rounded-xl pr-11"
                  disabled={busy}
                />
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </Field>
            <Field label="Confirm new password">
              <Input
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 rounded-xl"
                disabled={busy}
              />
            </Field>
            {errorBox}
            <Button
              type="submit"
              size="lg"
              disabled={busy}
              className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Saving…
                </>
              ) : (
                "Set New Password"
              )}
            </Button>
          </form>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center pb-32 text-center animate-fade-up">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-success/12 text-success">
            <CheckCircle2 className="h-9 w-9" />
          </span>
          <h1 className="text-[24px] font-extrabold tracking-tight">Password updated</h1>
          <p className="mt-2 max-w-[280px] text-[15px] text-muted-foreground">
            Your password has been reset. Sign in with your new password to open your vault.
          </p>
          <Button asChild size="lg" className="mt-8 h-[52px] w-full rounded-2xl text-[15px] font-bold">
            <Link to="/signin">Back to Sign In</Link>
          </Button>
        </div>
      )}

      {step !== "done" && (
        <p className="mt-auto py-8 text-center text-[14px] text-muted-foreground">
          Remembered it?{" "}
          <Link to="/signin" className="font-bold text-primary dark:text-foreground">
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
