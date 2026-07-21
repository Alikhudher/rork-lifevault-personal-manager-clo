import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Loader2, MailCheck, Vault } from "lucide-react";
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
} from "@/lib/account-recovery";
import { trackEmailDelivery, type DeliveryUpdate } from "@/lib/email-delivery";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_S = 60;

type Step = "form" | "code";

/**
 * Verified sign-up: the account does NOT exist until the user proves
 * they own the email address.
 *
 *  1. Name, email and password are entered and validated (real email
 *     format, minimum password length, email not already registered).
 *  2. A real 6-digit code is emailed via the auth server. Requesting a
 *     new code always invalidates the previous one (server-enforced),
 *     with a 60s resend countdown and truthful delivery status.
 *  3. Only after the server verifies the code is the account created
 *     and signed in — unverified sign-ups can never log in because no
 *     account is ever stored for them.
 */
export default function SignUp() {
  const { accounts, signUp } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [code, setCode] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState<number>(0);
  const [delivery, setDelivery] = useState<DeliveryUpdate | null>(null);

  // Resend countdown ticker.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const normalizedEmail = email.trim().toLowerCase();

  const emailAlreadyRegistered = accounts.some(
    (a) => a.email.toLowerCase() === normalizedEmail,
  );

  /** Email a real 6-digit code; used for both the first send and resends. */
  const sendCode = async (isResend: boolean): Promise<boolean> => {
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
      return false;
    }
    setCode("");
    setResendIn(RESEND_COOLDOWN_S);
    toast.success(isResend ? "A new code is on its way" : "Verification code sent", {
      description: isResend
        ? `A fresh code was emailed to ${normalizedEmail} — the previous code no longer works.`
        : `Check ${normalizedEmail} (and Spam) for a 6-digit code.`,
    });
    // Follow the message all the way to the inbox via Brevo's logs and
    // mirror the truthful status inline next to the code input.
    setDelivery(null);
    void trackEmailDelivery(normalizedEmail, sentAt, setDelivery);
    return true;
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (emailAlreadyRegistered) {
      setError("This email is already registered. Sign in instead.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const sent = await sendCode(false);
      if (sent) setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (busy) return;
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    try {
      // Server-side check — wrong or expired codes are always rejected.
      const result = await verifyEmailCode(normalizedEmail, code);
      if (result.ok === false) {
        setError(result.error);
        setCode("");
        return;
      }
      // Email ownership proven — the account may now be created. Keep the
      // cloud identity usable for future cloud backup (only when it has no
      // encrypted backup; an existing backup password is never touched).
      await alignCloudPasswordAfterReset(result.session, password);
      await finishVerifiedSession(result.session);

      const created = await signUp(name.trim(), normalizedEmail, password);
      if (!created.ok) {
        setError(
          created.error === "email_taken"
            ? "This email is already registered. Sign in instead."
            : "Couldn't create the account. Please try again.",
        );
        return;
      }
      toast.success(`Welcome to LifeVault, ${name.trim().split(" ")[0]}!`, {
        description: "Your email is verified and your vault is ready.",
      });
      navigate("/", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error ? (
    <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 ring-1 ring-destructive/25" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="text-[12.5px] font-semibold leading-relaxed text-destructive">
        {error}
        {error.includes("already registered") && (
          <>
            {" "}
            <Link to="/signin" className="underline">
              Go to Sign In
            </Link>
          </>
        )}
      </p>
    </div>
  ) : null;

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-safe">
      {step === "form" && (
        <>
          <div className="mb-10 pt-10">
            <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Vault className="h-7 w-7" />
            </span>
            <h1 className="text-[28px] font-extrabold tracking-tight">Create your vault</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              One secure place for documents, payments and appointments.
            </p>
          </div>

          <form onSubmit={handleContinue} className="space-y-4">
            <Field label="Full name">
              <Input
                autoComplete="name"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 rounded-xl"
                disabled={busy}
              />
            </Field>
            <Field
              label="Email"
              hint={
                emailAlreadyRegistered
                  ? "This email is already registered. Sign in instead."
                  : "We'll send a 6-digit code to verify this address."
              }
            >
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
            <Field label="Password" hint="At least 6 characters.">
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl pr-11"
                  disabled={busy}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
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
                "Continue — Verify Email"
              )}
            </Button>
          </form>
        </>
      )}

      {step === "code" && (
        <div className="animate-fade-up pt-10">
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-info/12 text-info">
            <MailCheck className="h-7 w-7" />
          </span>
          <h1 className="text-[28px] font-extrabold tracking-tight">Verify your email</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Enter the 6-digit code we sent to{" "}
            <span className="font-bold text-foreground">{normalizedEmail}</span>. It expires in 10
            minutes — only the newest code works. Your account is created only after verification.
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
                  onClick={() => {
                    if (busy) return;
                    setBusy(true);
                    void sendCode(true).finally(() => setBusy(false));
                  }}
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
              onClick={() => void handleVerify()}
              disabled={busy || code.length !== 6}
              className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify & Create Account"
              )}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
                setCode("");
                setDelivery(null);
              }}
              className="w-full text-center text-[13px] font-bold text-muted-foreground"
            >
              Use a different email
            </button>
          </div>
        </div>
      )}

      <p className="mt-auto py-8 text-center text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Link to="/signin" className="font-bold text-primary dark:text-foreground">
          Sign in
        </Link>
      </p>
    </div>
  );
}
