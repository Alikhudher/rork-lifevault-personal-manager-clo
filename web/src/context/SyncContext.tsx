/**
 * SyncContext — integration layer between the app's local state and the
 * cloud sync engine.
 *
 * Responsibilities:
 *  - Hold cloud auth + encryption-key session state.
 *  - Expose metadata (last backup/sync, record count, status) to the UI.
 *  - Run debounced auto-sync after local mutations and on app foreground.
 *  - Provide backup/restore/setup/change-password/disable actions.
 *  - Track per-record change stamps so incremental sync pushes exactly
 *    what changed (and deletions propagate as tombstones).
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
import { deriveKey, getSessionKey, setSessionKey } from "@/lib/crypto";
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
import { useApp, type RestoredRecord } from "@/context/AppContext";
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

/** Result of a cloud auth action, with a user-displayable error on failure. */
export type CloudAuthResult = { ok: true } | { ok: false; error: string };

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

  /** Create a Supabase account (or sign in) + prepare the encryption salt. */
  setupCloud: (email: string, backupPassword: string) => Promise<CloudAuthResult>;
  /** Sign in to Supabase + derive the encryption key from the stored salt. */
  unlockCloud: (email: string, backupPassword: string) => Promise<CloudAuthResult>;
  /** Forget the in-memory encryption key (lock cloud access). */
  lockCloud: () => void;
  /** Full back up now. */
  backupNow: () => Promise<boolean>;
  /** Full restore now. Returns the restored records. */
  restoreNow: () => Promise<RestoreResult>;
  /** Run incremental sync. Pass { silent: true } to suppress toasts (auto-sync). */
  syncNow: (opts?: { silent?: boolean }) => Promise<boolean>;
  /** Wipe all cloud data + sign out of Supabase. */
  disableCloud: () => Promise<boolean>;
  /** Change the backup password (re-derives key with new salt, re-encrypts). */
  changeBackupPassword: (current: string, next: string) => Promise<CloudAuthResult>;
  /** Refresh metadata from the server. */
  refreshMetadata: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const AUTO_SYNC_DELAY_MS = 4000;

/* ------------------------------------------------------------------ */
/* Error mapping                                                       */
/* ------------------------------------------------------------------ */

/** Map raw Supabase/auth/network errors to clear, actionable messages. */
function friendlyAuthError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/invalid login credentials|invalid_credentials/i.test(msg)) {
    return "Incorrect email or backup password. If you haven't enabled cloud backup yet, use “Enable cloud backup” instead.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Your email isn't confirmed yet. Tap the confirmation link we sent to your inbox, then try again.";
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/failed to fetch|network|fetch failed|load failed|timed? ?out/i.test(msg)) {
    return "Couldn't reach the cloud. Check your internet connection and try again.";
  }
  if (/password should be at least|weak password/i.test(msg)) {
    return "Backup password is too weak — use at least 8 characters.";
  }
  if (/invalid email|unable to validate email|is invalid/i.test(msg)) {
    return "That email address doesn't look valid. Double-check it and try again.";
  }
  return msg || "Something went wrong. Please try again.";
}

/** Map storage-layer errors (salt/table access) to actionable messages. */
function cloudStorageError(raw?: string): string {
  if (raw && /does not exist|schema cache|relation/i.test(raw)) {
    return "Your Supabase project is missing the vault tables. Apply the migration in web/supabase/migrations via the Supabase SQL editor, then try again.";
  }
  return raw
    ? `Cloud error: ${raw}`
    : "Couldn't reach the cloud. Check your connection and try again.";
}

/* ------------------------------------------------------------------ */
/* Change stamps — true mutation timestamps + delete tombstones        */
/* ------------------------------------------------------------------ */

interface ChangeStamp {
  /** Hash of the record's JSON payload at the last detected change. */
  h: number;
  /** ms timestamp of the last detected change (used as updatedAt). */
  t: number;
  /** Record kind, kept so tombstones can be emitted after local deletion. */
  k: VaultRecord["kind"];
  /** ms timestamp of local deletion (tombstone), if any. */
  d?: number;
}

const STAMPS_KEY = "lv-sync-stamps-v1";
const STAMP_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Fast djb2-xor hash of a record payload. */
function hashPayload(data: unknown): number {
  const str = JSON.stringify(data) ?? "null";
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function loadStamps(): Record<string, ChangeStamp> {
  try {
    const raw = localStorage.getItem(STAMPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChangeStamp>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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
  const recs: VaultRecord[] = [];
  for (const d of args.documents) {
    recs.push({ id: d.id, kind: "document", data: d, updatedAt: 0, deletedAt: null });
  }
  for (const e of args.expenses) {
    recs.push({ id: e.id, kind: "expense", data: e, updatedAt: 0, deletedAt: null });
  }
  for (const s of args.subscriptions) {
    recs.push({ id: s.id, kind: "subscription", data: s, updatedAt: 0, deletedAt: null });
  }
  for (const a of args.appointments) {
    recs.push({ id: a.id, kind: "appointment", data: a, updatedAt: 0, deletedAt: null });
  }
  for (const n of args.notifications) {
    recs.push({ id: n.id, kind: "notification", data: n, updatedAt: 0, deletedAt: null });
  }
  recs.push({ id: "__settings__", kind: "settings", data: args.settings, updatedAt: 0, deletedAt: null });
  recs.push({ id: "__security__", kind: "security", data: args.security, updatedAt: 0, deletedAt: null });
  return recs;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const { mergeRestoredRecords } = app;
  const [cloudSignedIn, setCloudSignedIn] = useState<boolean>(false);
  const [cloudUnlocked, setCloudUnlocked] = useState<boolean>(false);
  const [hasExistingBackup, setHasExistingBackup] = useState<boolean>(false);
  const [status, setStatus] = useState<SyncStatus>(supabaseConfigured ? "idle" : "disabled");
  const [metadata, setMetadata] = useState<SyncMetadata | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEmail = useRef<string | null>(null);
  const stampsRef = useRef<Record<string, ChangeStamp> | null>(null);

  /* ---------------------------------------------------------------- */
  /* Change-stamp helpers                                              */
  /* ---------------------------------------------------------------- */
  const getStamps = useCallback((): Record<string, ChangeStamp> => {
    if (!stampsRef.current) stampsRef.current = loadStamps();
    return stampsRef.current;
  }, []);

  const persistStamps = useCallback(() => {
    try {
      localStorage.setItem(STAMPS_KEY, JSON.stringify(getStamps()));
    } catch {
      // Non-fatal — stamps rebuild from scratch on next load.
    }
  }, [getStamps]);

  /**
   * Record server-known state so freshly restored/merged rows aren't
   * immediately re-uploaded as "changed" by the next sync pass.
   */
  const seedStamps = useCallback(
    (records: VaultRecord[]) => {
      const stamps = getStamps();
      for (const r of records) {
        stamps[r.id] = {
          h: hashPayload(r.data),
          t: r.updatedAt,
          k: r.kind,
          ...(r.deletedAt ? { d: r.deletedAt } : {}),
        };
      }
      persistStamps();
    },
    [getStamps, persistStamps],
  );

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
      sessionEmail.current = session.user?.email ?? sessionEmail.current;
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
  /* Shared post-sign-in step: fetch/create salt and derive the key   */
  /* ---------------------------------------------------------------- */
  const prepareEncryptionKey = useCallback(
    async (backupPassword: string): Promise<CloudAuthResult> => {
      const saltRes = await fetchSalt();
      if (!saltRes.ok) {
        const error = cloudStorageError(saltRes.error);
        setLastError(error);
        setStatus("error");
        return { ok: false, error };
      }
      let salt = saltRes.salt;
      const existed = salt !== null;
      if (!salt) {
        // Account exists but cloud backup was never initialised — finish
        // setup now with a fresh salt. Never reached when a salt exists,
        // so an established backup's salt is never rotated accidentally.
        const created = await initCloudSalt();
        if (!created.salt) {
          const error = cloudStorageError(created.error);
          setLastError(error);
          setStatus("error");
          return { ok: false, error };
        }
        salt = created.salt;
      }
      const key = await deriveKey(backupPassword, salt);
      setSessionKey(key);
      setCloudUnlocked(true);
      setHasExistingBackup(existed);
      setStatus("idle");
      setLastError(null);
      await refreshMetadata();
      return { ok: true };
    },
    [refreshMetadata],
  );

  /* ---------------------------------------------------------------- */
  /* Setup / unlock / lock                                            */
  /* ---------------------------------------------------------------- */
  const setupCloud = useCallback(
    async (email: string, backupPassword: string): Promise<CloudAuthResult> => {
      const sb = getSupabase();
      if (!sb) return { ok: false, error: "Cloud backup is not configured for this build." };
      try {
        const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
          email,
          password: backupPassword,
        });

        if (signUpErr) {
          // The account may already exist — try signing in with the same
          // credentials so "Enable" is idempotent for returning users.
          const { error: signInErr } = await sb.auth.signInWithPassword({
            email,
            password: backupPassword,
          });
          if (signInErr) {
            if (/already registered|already exists/i.test(signUpErr.message)) {
              const error =
                "An account with this email already exists, but this backup password doesn't match. Use “Unlock cloud backup” with your original backup password.";
              setLastError(error);
              setStatus("error");
              return { ok: false, error };
            }
            const error = friendlyAuthError(signInErr);
            setLastError(error);
            setStatus("error");
            return { ok: false, error };
          }
        } else if (!signUpData.session) {
          // Email confirmation is enabled on the Supabase project, so
          // sign-up returned no session. Try a direct sign-in (covers
          // auto-confirmed addresses); otherwise ask the user to confirm.
          const { error: signInErr } = await sb.auth.signInWithPassword({
            email,
            password: backupPassword,
          });
          if (signInErr) {
            const error =
              "Almost there — we sent a confirmation link to your inbox. Tap it, then come back and unlock cloud backup.";
            setLastError(error);
            setStatus("error");
            return { ok: false, error };
          }
        }

        setCloudSignedIn(true);
        sessionEmail.current = email;
        return await prepareEncryptionKey(backupPassword);
      } catch (err) {
        const error = friendlyAuthError(err);
        setLastError(error);
        setStatus("error");
        return { ok: false, error };
      }
    },
    [prepareEncryptionKey],
  );

  const unlockCloud = useCallback(
    async (email: string, backupPassword: string): Promise<CloudAuthResult> => {
      const sb = getSupabase();
      if (!sb) return { ok: false, error: "Cloud backup is not configured for this build." };
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password: backupPassword });
        if (error) {
          const friendly = friendlyAuthError(error);
          setLastError(friendly);
          setStatus("error");
          return { ok: false, error: friendly };
        }
        setCloudSignedIn(true);
        sessionEmail.current = email;
        return await prepareEncryptionKey(backupPassword);
      } catch (err) {
        const friendly = friendlyAuthError(err);
        setLastError(friendly);
        setStatus("error");
        return { ok: false, error: friendly };
      }
    },
    [prepareEncryptionKey],
  );

  const lockCloud = useCallback(() => {
    setSessionKey(null);
    setCloudUnlocked(false);
    setStatus("idle");
  }, []);

  /* ---------------------------------------------------------------- */
  /* Backup / restore / sync                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Build the current record set with real mutation timestamps:
   *  - each record's payload is hashed; changed/new payloads are stamped
   *    with "now" so incremental sync pushes them,
   *  - ids that disappeared locally become tombstones so deletions
   *    propagate to other devices (kept for 30 days, then pruned).
   */
  const buildCurrentRecords = useCallback((): VaultRecord[] => {
    const raw = buildRecordSet({
      documents: app.documents,
      expenses: app.expenses,
      subscriptions: app.subscriptions,
      appointments: app.appointments,
      notifications: app.notifications,
      settings: app.settings,
      security: app.security,
    });
    const stamps = getStamps();
    const now = Date.now();
    const seen = new Set<string>();
    const out: VaultRecord[] = [];

    for (const rec of raw) {
      seen.add(rec.id);
      const h = hashPayload(rec.data);
      const prev = stamps[rec.id];
      if (!prev || prev.h !== h || prev.d !== undefined) {
        stamps[rec.id] = { h, t: now, k: rec.kind };
      }
      out.push({ ...rec, updatedAt: stamps[rec.id].t, deletedAt: null });
    }

    // Tombstones for records that existed before but are gone locally.
    for (const id of Object.keys(stamps)) {
      if (seen.has(id)) continue;
      const st = stamps[id];
      if (st.d === undefined) {
        st.d = now;
        st.t = now;
      } else if (now - st.d > STAMP_TOMBSTONE_TTL_MS) {
        delete stamps[id];
        continue;
      }
      out.push({ id, kind: st.k, data: null, updatedAt: st.t, deletedAt: st.d });
    }

    persistStamps();
    return out;
  }, [
    app.documents,
    app.expenses,
    app.subscriptions,
    app.appointments,
    app.notifications,
    app.settings,
    app.security,
    getStamps,
    persistStamps,
  ]);

  const backupNow = useCallback(async (): Promise<boolean> => {
    if (!syncReady()) {
      setLastError("Cloud backup is not unlocked.");
      setStatus("error");
      toast.error("Unlock cloud backup first.");
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
        error: "Cloud restore is not unlocked. Enter your backup password first.",
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
      // Stamp restored rows with their server timestamps so the next
      // auto-sync doesn't re-upload everything that was just pulled.
      seedStamps(result.records);
      setStatus("idle");
      setProgress(100);
      setLastError(null);
      await refreshMetadata();
    } else if (!result.ok) {
      setLastError(result.error ?? null);
      setStatus("error");
    }
    return result;
  }, [refreshMetadata, seedStamps]);

  const syncNow = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      if (!syncReady()) {
        if (!opts?.silent) toast.error("Unlock cloud backup first.");
        return false;
      }
      setStatus("syncing");
      const records = buildCurrentRecords();
      const result = await syncIncremental(records);
      if (result.ok && !result.disabled) {
        if (result.remoteNewer.length > 0) {
          // Stamp remote rows BEFORE merging so the merge doesn't get
          // re-detected as a local change and echoed back up.
          seedStamps(result.remoteNewer);
          mergeRestoredRecords(result.remoteNewer as RestoredRecord[]);
        }
        setStatus("idle");
        setLastError(null);
        await refreshMetadata();
        if (!opts?.silent) {
          toast.success(
            result.uploaded > 0 || result.downloaded > 0
              ? `Synced — ${result.uploaded} pushed, ${result.downloaded} pulled`
              : "Everything is up to date",
          );
        }
        return true;
      }
      if (!result.ok) {
        setLastError(result.error ?? null);
        setStatus("error");
        if (!opts?.silent) toast.error(result.error ?? "Sync failed.");
      }
      return result.ok;
    },
    [buildCurrentRecords, mergeRestoredRecords, refreshMetadata, seedStamps],
  );

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
    // Reset change stamps — they describe the wiped cloud account.
    stampsRef.current = {};
    try {
      localStorage.removeItem(STAMPS_KEY);
    } catch {
      // ignore
    }
    setCloudSignedIn(false);
    setCloudUnlocked(false);
    setHasExistingBackup(false);
    setMetadata(null);
    setStatus("idle");
    setLastError(null);
    return true;
  }, []);

  const changeBackupPassword = useCallback(
    async (_current: string, next: string): Promise<CloudAuthResult> => {
      const sb = getSupabase();
      if (!sb) return { ok: false, error: "Cloud backup is not configured for this build." };
      if (!sessionEmail.current) return { ok: false, error: "Unlock cloud backup first." };
      try {
        const { error } = await sb.auth.updateUser({ password: next });
        if (error) {
          const friendly = friendlyAuthError(error);
          setLastError(friendly);
          setStatus("error");
          return { ok: false, error: friendly };
        }
        // Re-derive the key with a fresh salt and re-back-up.
        const created = await initCloudSalt();
        if (!created.salt) {
          const friendly = cloudStorageError(created.error);
          setLastError(friendly);
          setStatus("error");
          return { ok: false, error: friendly };
        }
        const key = await deriveKey(next, created.salt);
        setSessionKey(key);
        setCloudUnlocked(true);
        const backedUp = await backupNow();
        if (!backedUp) {
          return {
            ok: false,
            error: "Password changed, but re-encrypting your backup failed. Tap “Back up now” to finish.",
          };
        }
        return { ok: true };
      } catch (err) {
        const friendly = friendlyAuthError(err);
        setLastError(friendly);
        setStatus("error");
        return { ok: false, error: friendly };
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
      void syncNow({ silent: true });
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
