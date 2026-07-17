import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, KeyRound, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/lifevault/FormSheet";

export default function ForgotPassword() {
  const [email, setEmail] = useState<string>("");
  const [sent, setSent] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-8">
      <Link
        to="/signin"
        className="-ml-2 mb-8 flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-secondary"
        aria-label="Back to sign in"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>

      {sent ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-32 text-center animate-fade-up">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-success/12 text-success">
            <MailCheck className="h-9 w-9" />
          </span>
          <h1 className="text-[24px] font-extrabold tracking-tight">Check your inbox</h1>
          <p className="mt-2 max-w-[280px] text-[15px] text-muted-foreground">
            We sent a password reset link to <span className="font-bold text-foreground">{email}</span>.
          </p>
          <Button asChild size="lg" className="mt-8 h-[52px] w-full rounded-2xl text-[15px] font-bold">
            <Link to="/signin">Back to Sign In</Link>
          </Button>
        </div>
      ) : (
        <>
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-foreground">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="text-[28px] font-extrabold tracking-tight">Forgot password?</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Enter your email and we&apos;ll send you a reset link.
          </p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <Field label="Email">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-xl"
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
            >
              Send Reset Link
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
