import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Vault } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";

export default function SignUp() {
  const { signUp } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Enter your name");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    signUp(name.trim(), email.trim().toLowerCase(), password);
    toast.success(`Welcome to LifeVault, ${name.trim().split(" ")[0]}!`);
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-16">
      <div className="mb-10">
        <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Vault className="h-7 w-7" />
        </span>
        <h1 className="text-[28px] font-extrabold tracking-tight">Create your vault</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          One secure place for documents, payments and appointments.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name">
          <Input
            autoComplete="name"
            placeholder="Mia Thompson"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-xl"
          />
        </Field>
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
        <Field label="Password" hint="At least 6 characters.">
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
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

        <Button
          type="submit"
          size="lg"
          className="h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          Create Account
        </Button>
      </form>

      <p className="mt-auto py-8 text-center text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Link to="/signin" className="font-bold text-primary dark:text-foreground">
          Sign in
        </Link>
      </p>
    </div>
  );
}
