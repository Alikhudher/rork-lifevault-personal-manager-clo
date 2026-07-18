import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Delete, Fingerprint, Loader2, Lock, ScanFace, Vault } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { checkBiometry, type BiometryStatus } from "@/lib/security";
import { cn } from "@/lib/utils";

/**
 * Full-screen lock overlay shown on top of the app when `locked` is true.
 *
 * Two unlock paths:
 *  1. Face ID / Touch ID (if enabled & available) — auto-prompted on mount.
 *  2. Numeric PIN (if enabled) — a large tap-friendly keypad.
 *
 * Falls back to the PIN whenever biometrics are unavailable, fail, or are
 * cancelled. If neither method is enabled (shouldn't happen, since `locked`
 * only becomes true when a lock method is configured), the overlay is a no-op.
 */
export function AppLock() {
  const {
    locked,
    security,
    unlockWithBiometric,
    unlockWithPin,
    pinConfigured,
  } = useApp();

  const [biometry, setBiometry] = useState<BiometryStatus>({
    available: false,
    kind: "none",
    label: "",
  });
  const [mode, setMode] = useState<"biometric" | "pin">("biometric");
  const [pin, setPin] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(false);
  const [bioPrompting, setBioPrompting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [attempts, setAttempts] = useState<number>(0);

  const bioUsable = security.biometricEnabled && biometry.available;
  const pinUsable = security.pinEnabled && pinConfigured;
  const targetLength = security.pinLength;

  // Check biometry availability on mount.
  useEffect(() => {
    let active = true;
    void (async () => {
      const status = await checkBiometry();
      if (active) setBiometry(status);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Decide the initial mode whenever the lock overlay appears.
  useEffect(() => {
    if (!locked) {
      setPin("");
      setError("");
      setAttempts(0);
      setVerifying(false);
      setBioPrompting(false);
      return;
    }
    setPin("");
    setError("");
    setAttempts(0);
    if (bioUsable) {
      setMode("biometric");
      // Auto-prompt biometrics after a brief tick so the overlay animates in.
      const t = window.setTimeout(() => void runBiometric(), 250);
      return () => window.clearTimeout(t);
    }
    if (pinUsable) setMode("pin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  const runBiometric = useCallback(async () => {
    setBioPrompting(true);
    setError("");
    const outcome = await unlockWithBiometric();
    setBioPrompting(false);
    if (!outcome.ok) {
      const reason = outcome.reason;
      if (reason === "cancelled") {
        // Stay on biometric prompt; user can retry or switch to PIN.
        return;
      }
      if (reason === "lockout") {
        setError("Biometrics are locked. Use your PIN to unlock.");
        if (pinUsable) setMode("pin");
        return;
      }
      if (reason === "unavailable") {
        if (pinUsable) {
          setMode("pin");
          return;
        }
        setError("Biometrics aren't available right now.");
        return;
      }
      // failed
      setError("Face ID didn't recognize you. Try again or use your PIN.");
    }
  }, [unlockWithBiometric, pinUsable]);

  const submitPin = useCallback(
    async (fullPin: string) => {
      setVerifying(true);
      setError("");
      const ok = await unlockWithPin(fullPin);
      setVerifying(false);
      if (!ok) {
        setAttempts((a) => a + 1);
        setPin("");
        setError("Incorrect PIN. Try again.");
      }
    },
    [unlockWithPin],
  );

  const pushDigit = useCallback(
    (d: string) => {
      if (verifying) return;
      setError("");
      if (pin.length >= targetLength) return;
      const next = pin + d;
      setPin(next);
      if (next.length === targetLength) void submitPin(next);
    },
    [pin, verifying, targetLength, submitPin],
  );

  const popDigit = useCallback(() => {
    if (verifying) return;
    setError("");
    setPin((p) => p.slice(0, -1));
  }, [verifying]);

  const switchMode = useCallback(
    (m: "biometric" | "pin") => {
      setPin("");
      setError("");
      setMode(m);
      if (m === "biometric") void runBiometric();
    },
    [runBiometric],
  );

  const BioIcon = biometry.kind === "touchId" ? Fingerprint : ScanFace;
  const bioLabel = biometry.label || "Face ID";

  const headline = useMemo(() => {
    if (mode === "biometric") return bioPrompting ? `Authenticating with ${bioLabel}…` : `Unlock with ${bioLabel}`;
    return "Enter your PIN";
  }, [mode, bioPrompting, bioLabel]);

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background animate-fade-in">
      {/* Ambient gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-56 w-56 rounded-full bg-info/10 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-safe">
        {/* Vault glyph */}
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/30">
            <Vault className="h-10 w-10" strokeWidth={2.2} />
          </span>
          <div className="text-center">
            <h1 className="text-[24px] font-extrabold tracking-tight">LifeVault is locked</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">{headline}</p>
          </div>
        </div>

        {/* Biometric panel */}
        {mode === "biometric" && (
          <div className="mt-10 flex flex-col items-center gap-6">
            <button
              type="button"
              onClick={() => void runBiometric()}
              disabled={bioPrompting}
              aria-label={`Authenticate with ${bioLabel}`}
              className={cn(
                "flex h-24 w-24 items-center justify-center rounded-full bg-card text-primary shadow-lg ring-1 ring-border transition-transform active:scale-95 dark:text-foreground",
                bioPrompting && "opacity-70",
              )}
            >
              {bioPrompting ? (
                <Loader2 className="h-9 w-9 animate-spin" />
              ) : (
                <BioIcon className="h-10 w-10" strokeWidth={2} />
              )}
            </button>

            {error && (
              <p className="max-w-[260px] text-center text-[13px] font-bold text-destructive">{error}</p>
            )}

            {pinUsable && (
              <button
                type="button"
                onClick={() => switchMode("pin")}
                className="flex items-center gap-1.5 rounded-full bg-secondary/70 px-4 py-2 text-[13px] font-bold text-secondary-foreground transition-colors hover:bg-secondary active:scale-95"
              >
                <Lock className="h-3.5 w-3.5" /> Use PIN instead
              </button>
            )}
          </div>
        )}

        {/* PIN panel */}
        {mode === "pin" && (
          <div className="mt-10 flex w-full max-w-[300px] flex-col items-center gap-7">
            {/* Dots */}
            <div
              className="flex items-center gap-3"
              aria-label={`${pin.length} of ${targetLength} digits entered`}
            >
              {Array.from({ length: targetLength }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-3.5 w-3.5 rounded-full transition-all duration-150",
                    i < pin.length
                      ? "scale-110 bg-primary dark:bg-foreground"
                      : "bg-muted-foreground/25",
                  )}
                />
              ))}
            </div>

            {error && (
              <p className="-mt-4 text-[13px] font-bold text-destructive">{error}</p>
            )}

            {verifying && (
              <p className="-mt-4 flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…
              </p>
            )}

            {/* Keypad */}
            <div className="grid w-full grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={verifying}
                  onClick={() => pushDigit(d)}
                  className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[24px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
                >
                  {d}
                </button>
              ))}
              <div className="flex h-16 items-center justify-center">
                {bioUsable && (
                  <button
                    type="button"
                    onClick={() => switchMode("biometric")}
                    aria-label={`Use ${bioLabel}`}
                    className="flex h-16 w-full items-center justify-center rounded-2xl text-primary transition-all active:scale-95 dark:text-foreground"
                  >
                    <BioIcon className="h-6 w-6" />
                  </button>
                )}
              </div>
              <button
                type="button"
                disabled={verifying}
                onClick={() => pushDigit("0")}
                className="flex h-16 items-center justify-center rounded-2xl bg-secondary/60 text-[24px] font-bold tabular transition-all active:scale-95 active:bg-secondary disabled:opacity-40"
              >
                0
              </button>
              <button
                type="button"
                disabled={verifying || pin.length === 0}
                onClick={popDigit}
                aria-label="Delete digit"
                className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground transition-all active:scale-95 disabled:opacity-30"
              >
                <Delete className="h-6 w-6" />
              </button>
            </div>

            {bioUsable && (
              <button
                type="button"
                onClick={() => switchMode("biometric")}
                className="-mt-2 flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground"
              >
                <BioIcon className="h-3.5 w-3.5" /> Use {bioLabel} instead
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="relative pb-safe px-6 pb-6 text-center text-[12px] text-muted-foreground">
        Your data is encrypted and stored on this device.
      </p>
    </div>
  );
}
