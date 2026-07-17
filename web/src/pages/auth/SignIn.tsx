import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ScanFace, Vault } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";

export default function SignIn() {
  const { signIn, settings } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }
    signIn(email.trim().toLowerCase());
    toast.success("Welcome back!");
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? "/", { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-16">
      <div className="mb-10">
        <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Vault className="h-7 w-7" />
        </span>
        <h1 className="text-[28px] font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Sign in to your LifeVault account.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
        <Field label="Password">
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-xl pr-11"
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

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[13px] font-bold text-primary dark:text-foreground">
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          Sign In
        </Button>

        {settings.biometric && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-[52px] w-full rounded-2xl text-[15px] font-bold"
            onClick={() => {
              signIn("mia.thompson@example.com");
              toast.success("Unlocked with Face ID");
              navigate("/", { replace: true });
            }}
          >
            <ScanFace className="mr-2 h-5 w-5" /> Unlock with Face ID
          </Button>
        )}
      </form>

      <p className="mt-auto py-8 text-center text-[14px] text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link to="/signup" className="font-bold text-primary dark:text-foreground">
          Sign up
        </Link>
      </p>
    </div>
  );
}
