import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Delete,
  Fingerprint,
  Loader2,
  Lock,
  LockKeyhole,
  ScanFace,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { FormSheet, Field } from "@/components/lifevault/FormSheet";
import { useApp } from "@/context/AppContext";
import {
  authenticateWithBiometry,
  checkBiometry,
  verifyPin,
  type BiometryStatus,
} from "@/lib/security";
import {
  AUTO_LOCK_OPTIONS,
  PIN_LENGTH_OPTIONS,
  type AutoLockDelay,
  type PinLength,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared row primitives (mirror the Profile page for consistency)    */
/* ------------------------------------------------------------------ */

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
  icon: typeof Shield;
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
    <div className={className}>{content}
    </div>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-lock picker sheet                                              */
/* ------------------------------------------------------------------ */

function AutoLockSheet({
  open,
  onOpenChange,
  value,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AutoLockDelay;
  onConfirm: (v: AutoLockDelay) => void;
}) {
  const [draft, setDraft] = useState<AutoLockDelay>(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Auto-Lock" description="Choose when LifeVault should lock itself.">
      <div className="space-y-2">
        {AUTO_LOCK_OPTIONS.map((opt, i) => {
          const selected = draft === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => setDraft(opt.value)}
              className={cn(
                "flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left transition-colors",
                selected ? "bg-primary/8 ring-1 ring-primary/30" : "bg-secondary/50 hover:bg-secondary/70",
                i === AUTO_LOCK_OPTIONS.length - 1 && "mb-1",
              )}
            >
              <span className="text-[14px] font-bold">{opt.label}</span>
              {selected && <Check className="h-5 w-5 text-primary dark:text-foreground" />}
            </button>
          );
        })}
        <Button
          type="button"
          size="lg"
          onClick={() => {
            onConfirm(draft);
            onOpenChange(false);
          }}
          className="mt-4 h-[52px] w-full rounded-2xl text-[15px] font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
        >
          Done
        </Button>
      </div>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* PIN setup / change sheet                                           */
/* ------------------------------------------------------------------ */

type PinSheetMode = "create" | "change";

function PinSetupSheet({
  open,
  onOpenChange,
  mode,
  pinLength,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PinSheetMode;
  pinLength: PinLength;
  onSaved: () => void;
}) {
  const { setAppPin } = useApp();
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState<string>("");
  const [confirmPin, setConfirmPin] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setStep("enter");
      setFirstPin("");
      setConfirmPin("");
      setSaving(false);
      setError("");
    }
  }, [open]);

  const activePin = step === "enter" ? firstPin : confirmPin;
  const targetLength = pinLength;

  const pushDigit = useCallback(
    (d: string) => {
      setError("");
      if (step === "enter") {
        if (firstPin.length < targetLength) {
          const next = firstPin + d;
          setFirstPin(next);
          if (next.length === targetLength) setStep("confirm");
        }
      } else {
        if (confirmPin.length < targetLength) {
          const next = confirmPin + d;
          setConfirmPin(next);
          if (next.length === targetLength) {
            void submit(next);
          }
        }
      }
    },
    [step, firstPin, confirmPin, targetLength],
  );

  const popDigit = useCallback(() => {
    setError("");
    if (step === "confirm") {
      if (confirmPin.length > 0) {
        setConfirmPin((p) => p.slice(0, -1));
        return;
      }
      // Backspace at confirm-empty → jump back to enter step.
      setStep("enter");
      return;
    }
    setFirstPin((p) => p.slice(0, -1));
  }, [step, confirmPin.length]);

  const submit = useCallback(
    async (finalPin: string) => {
      if (finalPin !== firstPin) {
        setError("PINs don't match. Try again.");
        setConfirmPin("");
        setStep("enter");
        setFirstPin("");
        return;
      }
      setSaving(true);
      try {
        await setAppPin(finalPin);
        await new Promise((r) => setTimeout(r, 250));
        toast.success(mode === "create" ? "PIN created" : "PIN updated");
        onSaved();
        onOpenChange(false);
      } catch {
        setError("Couldn't save the PIN. Please try again.");
        setConfirmPin("");
        setStep("enter");
        setFirstPin("");
      } finally {
        setSaving(false);
      }
    },
    [firstPin, setAppPin, mode, onOpenChange, onSaved],
  );

  const subtitle =
    step === "enter"
      ? mode === "create"
        ? `Enter a ${targetLength}-digit PIN`
        : `Enter your new ${targetLength}-digit PIN`
      : "Re-enter to confirm";

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={mode === "create" ? "Create PIN" : "Change PIN"} description={subtitle}>
      <div className="flex flex-col items-center gap-7 py-4">
        {/* Dots */}
        <div className="flex items-center gap-3" aria-label={`${activePin.length} of ${targetLength} digits entered`}>
          {Array.from({ length: targetLength }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3.5 w-3.5 rounded-full transition-all duration-150",
                i < activePin.length ? "scale-110 bg-primary dark:bg-foreground" : "bg-muted-foreground/25",
              )}
            />
          ))}
        </div>

        {error && (
          <p className="-mt-3 text-[13px] font-bold text-destructive">{error}</p>
        )}

        {saving && (
          <p className="-mt-3 flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
          </p>
        )}

        {/* Number pad */}
        <div className="grid w-full max-w-[280px] grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              disabled={saving}
              onClick={() => pushDigit(d)}
              className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[22px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          <div className="flex h-16 items-center justify-center" aria-hidden />
          <button
            type="button"
            disabled={saving}
            onClick={() => pushDigit("0")}
            className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[22px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            disabled={saving || (step === "enter" && firstPin.length === 0) || (step === "confirm" && confirmPin.length === 0)}
            onClick={popDigit}
            aria-label="Delete digit"
            className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground transition-all active:scale-95 disabled:opacity-30"
          >
            <Delete className="h-6 w-6" />
          </button>
        </div>

        {step === "confirm" && (
          <button
            type="button"
            onClick={() => {
              setStep("enter");
              setFirstPin("");
              setConfirmPin("");
              setError("");
            }}
            className="-mt-2 text-[13px] font-bold text-muted-foreground"
          >
            Start over
          </button>
        )}
      </div>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Verify current PIN sheet                                            */
/* ------------------------------------------------------------------ */

/**
 * Requires the CURRENT PIN before a sensitive change (turning the PIN
 * off or replacing it). The attempt is checked against the stored
 * salted hash — a wrong PIN is always rejected.
 */
function ConfirmPinSheet({
  open,
  onOpenChange,
  pinLength,
  title,
  description,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinLength: PinLength;
  title: string;
  description: string;
  onVerified: () => void;
}) {
  const [pin, setPin] = useState<string>("");
  const [checking, setChecking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setPin("");
      setChecking(false);
      setError("");
    }
  }, [open]);

  const submit = useCallback(
    async (finalPin: string) => {
      setChecking(true);
      const ok = await verifyPin(finalPin);
      setChecking(false);
      if (!ok) {
        setError("Incorrect PIN. Try again.");
        setPin("");
        return;
      }
      onOpenChange(false);
      onVerified();
    },
    [onOpenChange, onVerified],
  );

  const pushDigit = useCallback(
    (d: string) => {
      if (checking) return;
      setError("");
      if (pin.length >= pinLength) return;
      const next = pin + d;
      setPin(next);
      if (next.length === pinLength) void submit(next);
    },
    [checking, pin, pinLength, submit],
  );

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex flex-col items-center gap-7 py-4">
        <div className="flex items-center gap-3" aria-label={`${pin.length} of ${pinLength} digits entered`}>
          {Array.from({ length: pinLength }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3.5 w-3.5 rounded-full transition-all duration-150",
                i < pin.length ? "scale-110 bg-primary dark:bg-foreground" : "bg-muted-foreground/25",
              )}
            />
          ))}
        </div>

        {error && <p className="-mt-3 text-[13px] font-bold text-destructive">{error}</p>}
        {checking && (
          <p className="-mt-3 flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
          </p>
        )}

        <div className="grid w-full max-w-[280px] grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              disabled={checking}
              onClick={() => pushDigit(d)}
              className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[22px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          <div className="flex h-16 items-center justify-center" aria-hidden />
          <button
            type="button"
            disabled={checking}
            onClick={() => pushDigit("0")}
            className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[22px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            disabled={checking || pin.length === 0}
            onClick={() => {
              setError("");
              setPin((p) => p.slice(0, -1));
            }}
            aria-label="Delete digit"
            className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground transition-all active:scale-95 disabled:opacity-30"
          >
            <Delete className="h-6 w-6" />
          </button>
        </div>
      </div>
    </FormSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Disable PIN confirmation                                            */
/* ------------------------------------------------------------------ */

function DisablePinDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="mx-auto max-w-[340px] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off PIN?</AlertDialogTitle>
          <AlertDialogDescription>
            You'll be able to unlock LifeVault without a PIN. If Face ID is also off, the app won't be locked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Keep PIN</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Turn off
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Security page                                                       */
/* ------------------------------------------------------------------ */

export default function Security() {
  const {
    security,
    updateSecurity,
    pinConfigured,
    setAppPin,
    removeAppPin,
  } = useApp();

  const [biometry, setBiometry] = useState<BiometryStatus>({
    available: false,
    kind: "none",
    label: "",
  });
  const [checkingBio, setCheckingBio] = useState<boolean>(true);

  // Auto-lock picker
  const [autoLockOpen, setAutoLockOpen] = useState<boolean>(false);

  // PIN sheets
  const [pinSheet, setPinSheet] = useState<{ mode: PinSheetMode; open: boolean }>({
    mode: "create",
    open: false,
  });
  const [disablePinOpen, setDisablePinOpen] = useState<boolean>(false);
  // Which sensitive action is waiting for current-PIN verification.
  const [confirmPinFor, setConfirmPinFor] = useState<"disable" | "change" | null>(null);

  // Check biometry availability on mount.
  useEffect(() => {
    let active = true;
    void (async () => {
      setCheckingBio(true);
      const status = await checkBiometry();
      if (active) {
        setBiometry(status);
        setCheckingBio(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const bioIcon = biometry.kind === "faceId" ? ScanFace : biometry.kind === "touchId" ? Fingerprint : ScanFace;

  const autoLockLabel = useMemo(() => {
    const found = AUTO_LOCK_OPTIONS.find((o) => o.value === security.autoLockDelay);
    return found?.label ?? "Immediately";
  }, [security.autoLockDelay]);

  const handleBiometricToggle = async (enabled: boolean) => {
    if (enabled && !biometry.available) {
      toast.error("Biometric authentication isn't available on this device.");
      return;
    }
    if (!enabled && security.biometricEnabled) {
      // Sensitive change: removing a protection layer requires the user
      // to authenticate first (mirrors iOS behaviour). If biometrics are
      // genuinely unavailable we allow the change so nobody gets stuck.
      const outcome = await authenticateWithBiometry("Confirm it's you to turn off biometric lock");
      if (!outcome.ok && outcome.reason !== "unavailable") {
        toast.error("Verification failed — biometric lock stays on.");
        return;
      }
    }
    updateSecurity({ biometricEnabled: enabled });
    toast.success(enabled ? `${biometry.label || "Biometric lock"} enabled` : "Biometric lock disabled");
  };

  const handleHideSwitcherToggle = (enabled: boolean) => {
    updateSecurity({ hideInAppSwitcher: enabled });
    toast.success(enabled ? "Privacy screen enabled" : "Privacy screen disabled", {
      description: enabled ? "App content is hidden in the App Switcher." : undefined,
    });
  };

  const handlePinToggle = (enabled: boolean) => {
    if (enabled) {
      setPinSheet({ mode: "create", open: true });
    } else {
      setDisablePinOpen(true);
    }
  };

  const confirmDisablePin = async () => {
    try {
      await removeAppPin();
      toast.success("PIN turned off");
    } catch {
      toast.error("Couldn't remove the PIN.");
    } finally {
      setDisablePinOpen(false);
    }
  };

  /** After the current PIN is verified, run the pending sensitive action. */
  const handlePinVerified = () => {
    const action = confirmPinFor;
    setConfirmPinFor(null);
    if (action === "disable") {
      void confirmDisablePin();
    } else if (action === "change") {
      setPinSheet({ mode: "change", open: true });
    }
  };

  const protectionLevel = useMemo(() => {
    const count = (security.biometricEnabled ? 1 : 0) + (security.pinEnabled ? 1 : 0) + (security.hideInAppSwitcher ? 1 : 0);
    if (count === 0) return { label: "Standard", icon: ShieldOff, tone: "text-muted-foreground" };
    if (count === 3) return { label: "Maximum", icon: ShieldCheck, tone: "text-success" };
    return { label: "Enhanced", icon: Shield, tone: "text-info" };
  }, [security.biometricEnabled, security.pinEnabled, security.hideInAppSwitcher]);

  const ProtectionIcon = protectionLevel.icon;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Security" subtitle="Protect your vault" back />

      {/* Hero — protection status */}
      <section className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(219,60%,15%)] to-[hsl(216,55%,28%)] p-5 text-white shadow-lg shadow-primary/15">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-info/20 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
              <ProtectionIcon className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Protection level</p>
              <p className="text-[20px] font-extrabold tracking-tight">{protectionLevel.label}</p>
              <p className="mt-0.5 text-[12px] text-white/70">
                {security.biometricEnabled || security.pinEnabled
                  ? "Your vault is locked when you're away."
                  : "Enable a lock method to secure your vault."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Unlock methods */}
      <section className="px-4 pt-6">
        <SectionTitle>Unlock methods</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={bioIcon}
            bubble="bg-info/12 text-info"
            title={biometry.available ? `${biometry.label} lock` : "Face ID / Touch ID"}
            subtitle={
              checkingBio
                ? "Checking availability…"
                : biometry.available
                  ? "Require biometrics to open the app"
                  : "Not available on this device"
            }
            right={
              <Switch
                checked={security.biometricEnabled}
                disabled={!biometry.available && !checkingBio}
                onCheckedChange={(enabled) => void handleBiometricToggle(enabled)}
                aria-label="Toggle biometric lock"
              />
            }
          />
          <SettingRow
            icon={LockKeyhole}
            bubble="bg-warning/12 text-warning"
            title="PIN lock"
            subtitle={pinConfigured ? `${security.pinLength}-digit PIN enabled` : "Set a numeric PIN as a backup"}
            right={
              <Switch
                checked={security.pinEnabled}
                onCheckedChange={handlePinToggle}
                aria-label="Toggle PIN lock"
              />
            }
          />
          {security.pinEnabled && (
            <>
              <SettingRow
                icon={Lock}
                bubble="bg-violet-500/12 text-violet-600 dark:text-violet-400"
                title="Change PIN"
                subtitle="Requires your current PIN"
                onClick={() => {
                  // Verify the current PIN before allowing a replacement.
                  if (pinConfigured) setConfirmPinFor("change");
                  else setPinSheet({ mode: "change", open: true });
                }}
              />
              <SettingRow
                icon={Eye}
                bubble="bg-slate-500/12 text-slate-600 dark:text-slate-400"
                title="PIN length"
                right={
                  <div className="flex gap-1.5">
                    {PIN_LENGTH_OPTIONS.map((len) => (
                      <button
                        key={len}
                        type="button"
                        onClick={() => {
                          updateSecurity({ pinLength: len });
                          toast.success(`PIN length set to ${len} digits`);
                        }}
                        className={cn(
                          "h-9 w-9 rounded-lg text-[13px] font-bold transition-all active:scale-95",
                          security.pinLength === len
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-secondary/60 text-muted-foreground",
                        )}
                        aria-label={`Use ${len}-digit PIN`}
                      >
                        {len}
                      </button>
                    ))}
                  </div>
                }
                isLast
              />
            </>
          )}
        </SettingsCard>
        {!biometry.available && !checkingBio && !security.pinEnabled && (
          <p className="mt-2.5 px-1 text-[12px] text-muted-foreground">
            No biometrics detected. Set a PIN to lock your vault.
          </p>
        )}
      </section>

      {/* Auto-lock */}
      <section className="px-4 pt-6">
        <SectionTitle>Auto-Lock</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={Lock}
            bubble="bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
            title="Lock automatically"
            subtitle={`Currently: ${autoLockLabel}`}
            onClick={() => setAutoLockOpen(true)}
            isLast
          />
        </SettingsCard>
        <p className="mt-2.5 px-1 text-[12px] text-muted-foreground">
          LifeVault locks after the app has been in the background. "Immediately" locks every time you swipe away.
        </p>
      </section>

      {/* Privacy */}
      <section className="px-4 pt-6">
        <SectionTitle>Privacy</SectionTitle>
        <SettingsCard>
          <SettingRow
            icon={EyeOff}
            bubble="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            title="Hide in App Switcher"
            subtitle="Blur the app preview in recent apps"
            right={
              <Switch
                checked={security.hideInAppSwitcher}
                onCheckedChange={handleHideSwitcherToggle}
                aria-label="Toggle hide in app switcher"
              />
            }
            isLast
          />
        </SettingsCard>
        <p className="mt-2.5 px-1 text-[12px] text-muted-foreground">
          A privacy shield hides LifeVault's content when you swipe to the App Switcher or take a screenshot.
        </p>
      </section>

      {/* How it works */}
      <section className="px-4 pt-6">
        <SectionTitle>How it works</SectionTitle>
        <div className="space-y-2.5">
          {[
            {
              icon: ScanFace,
              title: "Unlock with Face ID",
              text: "Open LifeVault and authenticate with a glance. On failure, fall back to your PIN.",
            },
            {
              icon: LockKeyhole,
              title: "PIN as a backup",
              text: "If biometrics are unavailable or fail, your PIN always unlocks the vault.",
            },
            {
              icon: Shield,
              title: "Secured on-device",
              text: "Your PIN hash and settings are stored in the iOS Keychain — never on a server.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-foreground">
                <item.icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-bold">{item.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pt-6">
        <div className="flex items-center gap-2 rounded-2xl bg-info/8 p-4 ring-1 ring-info/20">
          <Sparkles className="h-4 w-4 shrink-0 text-info" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Tip: combine Face ID, a PIN, and the privacy shield for the strongest protection.
          </p>
        </div>
        <p className="pb-6 pt-6 text-center text-[12px] text-muted-foreground">
          Your security settings are stored securely on this device.
        </p>
      </section>

      {/* ---------------- Sheets ---------------- */}

      <AutoLockSheet
        open={autoLockOpen}
        onOpenChange={setAutoLockOpen}
        value={security.autoLockDelay}
        onConfirm={(v: AutoLockDelay) => {
          updateSecurity({ autoLockDelay: v });
          toast.success("Auto-Lock updated");
        }}
      />

      <PinSetupSheet
        open={pinSheet.open}
        onOpenChange={(o) => setPinSheet((s) => ({ ...s, open: o }))}
        mode={pinSheet.mode}
        pinLength={security.pinLength}
        onSaved={() => {
          // The PIN hash is written to the Keychain inside the sheet;
          // ensure the length pref is consistent with what was set up.
          updateSecurity({ pinEnabled: true, pinLength: security.pinLength });
        }}
      />

      <DisablePinDialog
        open={disablePinOpen}
        onOpenChange={setDisablePinOpen}
        onConfirm={() => {
          setDisablePinOpen(false);
          // Turning the PIN off requires the CURRENT PIN first.
          if (pinConfigured) setConfirmPinFor("disable");
          else void confirmDisablePin();
        }}
      />

      <ConfirmPinSheet
        open={confirmPinFor !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmPinFor(null);
        }}
        pinLength={security.pinLength}
        title="Enter current PIN"
        description={
          confirmPinFor === "disable"
            ? "Confirm your current PIN to turn PIN lock off."
            : "Confirm your current PIN before choosing a new one."
        }
        onVerified={handlePinVerified}
      />
    </div>
  );
}
