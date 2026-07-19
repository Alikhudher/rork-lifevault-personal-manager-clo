/**
 * SyncContext — integration layer between the app's local state and the
 * cloud sync engine.
 *
 * Responsibilities:
 *  - Hold cloud auth + encryption-key session state.
 *  - Expose metadata (last backup/sync, record count, status) to the UI.
 *  - Run debounced auto-sync after local mutations and on app foreground.
 *  - Provide backup/restore/setup/change-password/disable actions.
 *
 * Lives OUTSIDE AppContext so it can read AppContext state without a
 * circular provider dependency. Wrapped in App.tsx around AppProvider.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getSupabase, getSupabaseSession, supabaseConfigured } from "@/lib/supabase";
import {
  deriveKey,
  generateSalt,
  getSessionKey,
  setSessionKey,
} from "@/lib/crypto";
import {
  backupAll,
  fetchSalt,
  getSyncMetadata,
  hasCloudBackup,
  initCloudSalt,
  restoreAll,
  syncIncremental,
  syncReady,
  wipeCloudData,
  type RestoreResult,
  type SyncMetadata,
  type VaultRecord,
} from "@/lib/sync";
import { useApp } from "@/context/AppContext";
import type {
  AppNotification,
  Appointment,
  Expense,
  SecuritySettings,
  Settings,
  Subscription,
  VaultDocument,
} from "@/lib/types";

export type SyncStatus = "idle" | "syncing" | "error" | "disabled";

interface SyncContextValue {
  /** True when Supabase env vars are present. */
  cloudAvailable: boolean;
  /** True when the user is signed in to Supabase (has a session). */
  cloudSignedIn: boolean;
  /** True when an encryption key is unlocked in memory. */
  cloudUnlocked: boolean;
  /** True when a cloud backup already exists for this account. */
  hasExistingBackup: boolean;
  status: SyncStatus;
  metadata: SyncMetadata | null;
  /** 0–100 progress during backup/restore. */
  progress: number;
  /** Last error message, or null. */
  lastError: string | null;

  /** Create a Supabase account + store a fresh salt. */
  setupCloud: (email: string, backupPassword: string) => Promise<boolean>;
  /** Sign in to Supabase + derive the encryption key from the stored salt. */
  unlockCloud: (email: string, backupPassword: string) => Promise<boolean>;
  /** Forget the in-memory encryption key (lock cloud access). */
  lockCloud: () => void;
  /** Full back up now. */
  backupNow: () => Promise<boolean>;
  /** Full restore now. Returns the restored records. */
  restoreNow: () => Promise<RestoreResult>;
  /** Run incremental sync. */
  syncNow: () => Promise<boolean>;
  /** Wipe all cloud data + sign out of Supabase. */
  disableCloud: () => Promise<boolean>;
  /** Change the backup password (re-derives key with new salt, re-encrypts). */
  changeBackupPassword: (current: string, next: string) => Promise<boolean>;
  /** Refresh metadata from the server. */
  refreshMetadata: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const AUTO_SYNC_DELAY_MS = 4000;

/** Build the flat list of VaultRecords to upload from current app state. */
function buildRecordSet(args: {
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
  notifications: AppNotification[];
  settings: Settings;
  security: SecuritySettings;
}): VaultRecord[] {
  const now = Date.now();
  const recs: VaultRecord[] = [];
  for (const d of args.documents) {
    recs.push({ id: d.id, kind: "document", data: d, updatedAt: new Date(d.createdAt).getTime() || now, deletedAt: null });
  }
  for (const e of args.expenses) {
    recs.push({ id: e.id, kind: "expense", data: e, updatedAt: new Date(e.date).getTime() || now, deletedAt: null });
  }
  for (const s of args.subscriptions) {
    recs.push({ id: s.id, kind: "subscription", data: s, updatedAt: new Date(s.nextPaymentDate).getTime() || now, deletedAt: null });
  }
  for (const a of args.appointments) {
    recs.push({ id: a.id, kind: "appointment", data: a, updatedAt: new Date(`${a.date}T${a.time || "00:00"}`).getTime() || now, deletedAt: null });
  }
  for (const n of args.notifications) {
    recs.push({ id: n.id, kind: "notification", data: n, updatedAt: new Date(n.date).getTime() || now, deletedAt: n.read ? null : null });
  }
  recs.push({ id: "__settings__", kind: "settings", data: args.settings, updatedAt: now, deletedAt: null });
  recs.push({ id: "__security__", kind: "security", data: args.security, updatedAt: now, deletedAt: null });
  return recs;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const [cloudSignedIn, setCloudSignedIn] = useState<boolean>(false);
  const [cloudUnlocked, setCloudUnlocked] = useState<boolean>(false);
  const [hasExistingBackup, setHasExistingBackup] = useState<boolean>(false);
  const [status, setStatus] = useState<SyncStatus>(supabaseConfigured ? "idle" : "disabled");
  const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEmail = useRef<string | null>(null);

  /* ---------------------------------------------------------------- */
  /* Cloud session bootstrap                                          */
  /* ---------------------------------------------------------------- */
  const refreshMetadata = useCallback(async () => {
    if (!supabaseConfigured) return;
    const md = await getSyncMetadata();
    setMetadata(md);
  }, []);

  const checkSession = useCallback(async () => {
    if (!supabaseConfigured) return;
    const session = await getSupabaseSession();
    setCloudSignedIn(Boolean(session));
    if (session) {
      const exists = await hasCloudBackup();
      setHasExistingBackup(exists);
      await refreshMetadata();
    } else {
      setHasExistingBackup(false);
      setMetadata(null);
    }
  }, [refreshMetadata]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  /* ---------------------------------------------------------------- */
  /* Setup / unlock / lock                                            */
  /* ---------------------------------------------------------------- */
  const setupCloud = useCallback(
    async (email: string, backupPassword: string): Promise<boolean> => {
      const sb = getSupabase();
      if (!sb) return false;
      try {
        // Sign up (or sign in if the account already exists).
        const { error: signUpErr } = await sb.auth.signUp({ email, password: backupPassword });
        if (signUpErr && !/already registered/i.test(signUpErr.message)) {
          // Try sign-in instead (account may already exist).
          const { error: signInErr } = await sb.auth.signInWithPassword({ email, password: backupPassword });
          if (signInErr) throw signInErr;
        }
        setCloudSignedIn(true);
        sessionEmail.current = email;

        // Fresh salt → new key. Wipe any prior salt so the new key wins.
        const salt = await initCloudSalt();
        if (!salt) throw new Error("Could not initialise cloud encryption salt.");
        const key = await deriveKey(backupPassword, salt);
        setSessionKey(key);
        setCloudUnlocked(true);
        setHasExistingBackup(false);
        setStatus("idle");
        setLastError(null);
        await refreshMetadata();
        return true;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Cloud setup failed.");
        setStatus("error");
        return false;
      }
    },
    [refreshMetadata],
  );

  const unlockCloud = useCallback(
    async (email: string, backupPassword: string): Promise<boolean> => {
      const sb = getSupabase();
      if (!sb) return false;
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password: backupPassword });
        if (error) throw error;
        setCloudSignedIn(true);
        sessionEmail.current = email;

        const salt = await fetchSalt();
        if (!salt) throw new Error("No cloud backup found for this account.");
        const key = await deriveKey(backupPassword, salt);
        setSessionKey(key);
        setCloudUnlocked(true);
        setHasExistingBackup(true);
        setStatus("idle");
        setLastError(null);
        await refreshMetadata();
        return true;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Cloud unlock failed.");
        setStatus("error");
        return false;
      }
    },
    [refreshMetadata],
  );

  const lockCloud = useCallback(() => {
    setSessionKey(null);
    setCloudUnlocked(false);
    setStatus("idle");
  }, []);

  /* ---------------------------------------------------------------- */
  /* Backup / restore / sync                                          */
  /* ---------------------------------------------------------------- */
  const buildCurrentRecords = useCallback(
    () =>
      buildRecordSet({
        documents: app.documents,
        expenses: app.expenses,
        subscriptions: app.subscriptions,
        appointments: app.appointments,
        notifications: app.notifications,
        settings: app.settings,
        security: app.security,
      }),
    [app.documents, app.expenses, app.subscriptions, app.appointments, app.notifications, app.settings, app.security],
  );

  const backupNow = useCallback(async (): Promise<boolean> => {
    if (!syncReady()) {
      setLastError("Cloud backup is not unlocked.");
      setStatus("error");
      return false;
    }
    setStatus("syncing");
    setProgress(0);
    const records = buildCurrentRecords();
    const result = await backupAll(records, (done, total) => {
      setProgress(total > 0 ? Math.round((done / total) * 100) : 100);
    });
    // SyncOutcome is a discriminated union on `ok` + `disabled`. Narrow
    // with explicit literal comparisons so TS tracks each branch.
    if (result.ok === false) {
      const errorMsg = result.error;
      setLastError(errorMsg);
      setStatus("error");
      toast.error(errorMsg);
      return false;
    }
    if (result.ok === true && result.disabled === true) {
      setStatus("disabled");
      return false;
    }
    // result.ok === true && result.disabled === false
    const uploaded = result.uploaded;
    setStatus("idle");
    setProgress(100);
    setLastError(null);
    await refreshMetadata();
    toast.success(`Backed up ${uploaded} records to the cloud`);
    return true;
  }, [buildCurrentRecords, refreshMetadata]);

  const restoreNow = useCallback(async (): Promise<RestoreResult> => {
    if (!syncReady()) {
      const disabled: RestoreResult = {
        ok: false,
        disabled: !supabaseConfigured,
        records: [],
        error: "Cloud restore is not unlocked.",
      };
      setLastError(disabled.error ?? null);
      setStatus("error");
      return disabled;
    }
    setStatus("syncing");
    setProgress(0);
    const result = await restoreAll((done, total) => {
      setProgress(total > 0 ? Math.round((done / total) * 100) : 100);
    });
    if (result.ok && !result.disabled) {
      setStatus("idle");
      setProgress(100);
      setLastError(null);
      await refreshMetadata();
    } else if (!result.ok) {
      setLastError(result.error ?? null);
      setStatus("error");
    }
    return result;
  }, [refreshMetadata]);

  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!syncReady()) return false;
    setStatus("syncing");
    const records = buildCurrentRecords();
    const result = await syncIncremental(records);
    if (result.ok && !result.disabled) {
      setStatus("idle");
      setLastError(null);
      await refreshMetadata();
      return true;
    }
    if (!result.ok) {
      setLastError(result.error ?? null);
      setStatus("error");
    }
    return result.ok;
  }, [buildCurrentRecords, refreshMetadata]);

  const disableCloud = useCallback(async (): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb) return false;
    const w = await wipeCloudData();
    if (!w.ok) {
      setLastError(w.error ?? null);
      return false;
    }
    await sb.auth.signOut();
    setSessionKey(null);
    setCloudSignedIn(false);
    setCloudUnlocked(false);
    setHasExistingBackup(false);
    setMetadata(null);
    setStatus("idle");
    setLastError(null);
    return true;
  }, []);

  const changeBackupPassword = useCallback(
    async (_current: string, next: string): Promise<boolean> => {
      const sb = getSupabase();
      if (!sb || !sessionEmail.current) return false;
      try {
        const { error } = await sb.auth.updateUser({ password: next });
        if (error) throw error;
        // Re-derive the key with a fresh salt and re-back-up.
        const salt = await initCloudSalt();
        if (!salt) throw new Error("Could not rotate encryption salt.");
        const key = await deriveKey(next, salt);
        setSessionKey(key);
        setCloudUnlocked(true);
        await backupNow();
        toast.success("Backup password changed and data re-encrypted");
        return true;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : "Could not change password.");
        setStatus("error");
        return false;
      }
    },
    [backupNow],
  );

  /* ---------------------------------------------------------------- */
  /* Debounced auto-sync after local mutations                        */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!cloudUnlocked) return;
    if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    autoSyncTimer.current = setTimeout(() => {
      void syncNow();
    }, AUTO_SYNC_DELAY_MS);
    return () => {
      if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    };
  }, [cloudUnlocked, syncNow, app.documents, app.expenses, app.subscriptions, app.appointments, app.notifications, app.settings, app.security]);

  const value = useMemo<SyncContextValue>(
    () => ({
      cloudAvailable: supabaseConfigured,
      cloudSignedIn,
      cloudUnlocked,
      hasExistingBackup,
      status,
      metadata,
      progress,
      lastError,
      setupCloud,
      unlockCloud,
      lockCloud,
      backupNow,
      restoreNow,
      syncNow,
      disableCloud,
      changeBackupPassword,
      refreshMetadata,
    }),
    [
      cloudSignedIn,
      cloudUnlocked,
      hasExistingBackup,
      status,
      metadata,
      progress,
      lastError,
      setupCloud,
      unlockCloud,
      lockCloud,
      backupNow,
      restoreNow,
      syncNow,
      disableCloud,
      changeBackupPassword,
      refreshMetadata,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** Access the sync context. Throws if used outside SyncProvider. */
export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used inside SyncProvider");
  return ctx;
}

export { getSessionKey };
