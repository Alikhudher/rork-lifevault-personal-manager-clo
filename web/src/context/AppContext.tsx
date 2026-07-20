import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  currentDeviceSession,
  DEFAULT_SETTINGS,
  DEMO_ACCOUNT_EMAIL,
  DEMO_DEFAULT_BUDGET,
  DEMO_RECORD_IDS,
  DEMO_SESSION_IDS,
} from "@/lib/mock-data";
import { uid } from "@/lib/format";
import {
  authenticateWithBiometry,
  clearPin,
  hasPin,
  setPin as secureSetPin,
  setPrivacyScreen,
  verifyPin,
  type BiometricAuthOutcome,
} from "@/lib/security";
import type {
  AppNotification,
  Appointment,
  AutoLockDelay,
  DeviceSession,
  Expense,
  PinLength,
  RegisteredAccount,
  SecuritySettings,
  Settings,
  Subscription,
  SyncedAccountCredentials,
  UserProfile,
  VaultDocument,
} from "@/lib/types";
import { DEFAULT_SECURITY_SETTINGS } from "@/lib/types";

const STORAGE_KEY = "lifevault-state-v1";

interface PersistedState {
  onboarded: boolean;
  user: UserProfile | null;
  /** Email of the most recently signed-in account, used for Face ID unlock. */
  lastEmail: string | null;
  /** Persistent registry of registered accounts — survives logout. */
  accounts: RegisteredAccount[];
  settings: Settings;
  /** Security settings persisted to localStorage (the PIN hash itself lives in the Keychain). */
  security: SecuritySettings;
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
  notifications: AppNotification[];
  sessions: DeviceSession[];
}

export type AuthResult =
  | { ok: true; error: null }
  | { ok: false; error: "not_found" | "wrong_password" };

interface AppContextValue extends PersistedState {
  completeOnboarding: () => void;
  /** Validates the password against the stored hash before signing in. */
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** Convenience for Face ID unlock — skips password validation. */
  signInWithBiometric: () => AuthResult;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signOut: () => void;
  deleteAccount: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateSecurity: (patch: Partial<SecuritySettings>) => void;
  updateUser: (patch: Partial<UserProfile>) => void;
  /**
   * Change the signed-in account's password. The current password is
   * cryptographically verified against the stored hash — a wrong
   * current password is ALWAYS rejected. On success the user stays
   * signed in here and every other device session is revoked.
   */
  changePassword: (current: string, next: string) => Promise<boolean>;
  /** Verify the signed-in account's password (for sensitive actions). */
  verifyAccountPassword: (password: string) => Promise<boolean>;
  /**
   * Set a new password for an account after its email ownership has
   * been verified (Forgot Password flow). Never call without a
   * completed email verification.
   */
  resetAccountPassword: (email: string, newPassword: string) => Promise<boolean>;
  revokeSession: (id: string) => void;
  signOutAllDevices: () => void;
  verifyEmail: () => void;

  /* ---- App lock lifecycle ---- */
  /** Whether the app is currently showing the lock screen. */
  locked: boolean;
  /** Whether any security method (biometric or PIN) is configured. */
  appLockEnabled: boolean;
  /** Lock the app now (shows lock overlay). */
  lockApp: () => void;
  /** Attempt to unlock with the device's biometric. */
  unlockWithBiometric: () => Promise<BiometricAuthOutcome>;
  /** Attempt to unlock with a PIN. */
  unlockWithPin: (pin: string) => Promise<boolean>;
  /** Set or replace the PIN (writes hash to Keychain). */
  setAppPin: (pin: string) => Promise<void>;
  /** Remove the PIN entirely. */
  removeAppPin: () => Promise<void>;
  /** True when a PIN has been stored in secure storage. */
  pinConfigured: boolean;
  /** Notify the context that the app was backgrounded (used for auto-lock). */
  noteBackgrounded: () => void;
  /** Notify the context that the app returned to the foreground. */
  noteForegrounded: () => void;

  addDocument: (doc: Omit<VaultDocument, "id" | "createdAt">) => void;
  updateDocument: (id: string, patch: Partial<VaultDocument>) => void;
  deleteDocument: (id: string) => void;

  addExpense: (expense: Omit<Expense, "id">) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;

  addSubscription: (sub: Omit<Subscription, "id">) => void;
  updateSubscription: (id: string, patch: Partial<Subscription>) => void;
  deleteSubscription: (id: string) => void;

  addAppointment: (apt: Omit<Appointment, "id">) => void;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  deleteAppointment: (id: string) => void;

  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  unreadCount: number;

  /* ---- Cloud restore ---- */
  /** Replace all local state with the given restored records (cloud restore). */
  applyRestoredRecords: (records: RestoredRecord[]) => void;
  /**
   * Merge cloud records into local state (incremental sync pull).
   * Upserts records by id; tombstoned records (deletedAt set) are removed.
   */
  mergeRestoredRecords: (records: RestoredRecord[]) => void;
  /** Wipe all local data (used when disabling cloud backup). */
  clearLocalData: () => void;
}

/** A flat record as returned by the cloud sync engine. */
export interface RestoredRecord {
  id: string;
  kind:
    | "document"
    | "expense"
    | "subscription"
    | "appointment"
    | "notification"
    | "settings"
    | "security"
    | "account"
    | "folder";
  data: unknown;
  updatedAt: number;
  deletedAt: number | null;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * State for a brand-new install: completely empty. No demo documents,
 * expenses, subscriptions, appointments, notifications or budget — records
 * exist only after the user creates them.
 */
function freshSeed(): PersistedState {
  return {
    onboarded: false,
    user: null,
    lastEmail: null,
    accounts: [],
    settings: { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } },
    security: { ...DEFAULT_SECURITY_SETTINGS },
    documents: [],
    expenses: [],
    subscriptions: [],
    appointments: [],
    notifications: [],
    sessions: [currentDeviceSession()],
  };
}

/**
 * Strips demo/sample data that pre-release builds seeded into installs
 * (TestFlight devices persisted it in localStorage). Idempotent and cheap,
 * so it runs on every load. Exact-id matching is safe: user-created ids
 * come from uid() and can never collide with the fixed demo ids. Cloud
 * copies are cleaned up automatically — the sync engine emits tombstones
 * for ids that disappear locally.
 */
function purgeDemoData(state: PersistedState): PersistedState {
  const isDemoEmail = (email: string | null | undefined): boolean =>
    (email ?? "").toLowerCase() === DEMO_ACCOUNT_EMAIL;
  const hadDemoAccount = state.accounts.some((a) => isDemoEmail(a.email));
  const sessions = state.sessions.filter((s) => !DEMO_SESSION_IDS.has(s.id));
  return {
    ...state,
    user: isDemoEmail(state.user?.email) ? null : state.user,
    lastEmail: isDemoEmail(state.lastEmail) ? null : state.lastEmail,
    accounts: state.accounts.filter((a) => !isDemoEmail(a.email)),
    documents: state.documents.filter((d) => !DEMO_RECORD_IDS.has(d.id)),
    expenses: state.expenses.filter((e) => !DEMO_RECORD_IDS.has(e.id)),
    subscriptions: state.subscriptions.filter((s) => !DEMO_RECORD_IDS.has(s.id)),
    appointments: state.appointments.filter((a) => !DEMO_RECORD_IDS.has(a.id)),
    notifications: state.notifications.filter((n) => !DEMO_RECORD_IDS.has(n.id)),
    sessions: sessions.length > 0 ? sessions : [currentDeviceSession()],
    // The seeded $3,800 budget only counts as demo data while the demo
    // account is still present — a value the user set later is kept.
    settings:
      hadDemoAccount && state.settings.monthlyBudget === DEMO_DEFAULT_BUDGET
        ? { ...state.settings, monthlyBudget: 0 }
        : state.settings,
  };
}

/** Drop the legacy plaintext password field older builds kept on the profile. */
function sanitizeUser(user: (UserProfile & { password?: unknown }) | null | undefined): UserProfile | null {
  if (!user) return null;
  const { password: _legacyPassword, ...rest } = user;
  return rest as UserProfile;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshSeed();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const seed = freshSeed();
    return purgeDemoData({
      ...seed,
      ...parsed,
      user: sanitizeUser(parsed.user),
      settings: { ...seed.settings, ...parsed.settings, notifications: { ...seed.settings.notifications, ...parsed.settings?.notifications } },
      security: { ...seed.security, ...parsed.security },
      sessions: parsed.sessions && parsed.sessions.length > 0 ? parsed.sessions : seed.sessions,
      accounts: parsed.accounts ?? [],
      lastEmail: parsed.lastEmail ?? parsed.user?.email ?? null,
    });
  } catch (error) {
    console.error("Failed to load saved state, starting fresh", error);
    return freshSeed();
  }
}

/** Build a UserProfile session from a registered account (never carries credentials). */
function profileFromAccount(account: RegisteredAccount): UserProfile {
  return {
    name: account.name,
    email: account.email,
    photo: account.photo,
    createdAt: account.createdAt,
    emailVerified: account.emailVerified,
  };
}

function findAccount(accounts: RegisteredAccount[], email: string): RegisteredAccount | undefined {
  return accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
}

/** True when the account has any credential configured (hash or legacy). */
export function accountHasPassword(account: RegisteredAccount | undefined): boolean {
  if (!account) return false;
  return Boolean(
    (account.passwordHash && account.passwordSalt) ||
      (typeof account.password === "string" && account.password.length > 0),
  );
}

/**
 * Verify a password attempt against an account. Hashed credentials are
 * checked with a constant-time PBKDF2 comparison; legacy plaintext
 * accounts (pre-hashing builds) fall back to direct comparison until
 * their one-time migration completes.
 */
async function accountPasswordMatches(account: RegisteredAccount, password: string): Promise<boolean> {
  if (account.passwordHash && account.passwordSalt) {
    return verifyPassword(password, account.passwordSalt, account.passwordHash);
  }
  if (typeof account.password === "string" && account.password.length > 0) {
    return account.password === password;
  }
  return false;
}

/** Return the account with fresh hashed credentials and no plaintext. */
function withCredentials(
  account: RegisteredAccount,
  hash: string,
  salt: string,
  changedAt: number,
): RegisteredAccount {
  return {
    ...account,
    passwordHash: hash,
    passwordSalt: salt,
    passwordChangedAt: changedAt,
    password: undefined,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => loadState());

  // Keep a synchronous ref to the latest state so auth methods can read
  // accounts/user synchronously and return a result before React re-renders.
  const stateRef = useRef<PersistedState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Failed to persist state", error);
    }
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.settings.darkMode);
  }, [state.settings.darkMode]);

  // One-time migration: accounts persisted by pre-hashing builds still
  // carry a plaintext password. Re-store them as salted PBKDF2 hashes
  // and drop the plaintext. Sign-in also upgrades lazily, so auth works
  // even before this completes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const legacy = stateRef.current.accounts.filter(
        (a) =>
          (!a.passwordHash || !a.passwordSalt) &&
          typeof a.password === "string" &&
          a.password.length > 0,
      );
      if (legacy.length === 0) return;
      try {
        const upgraded = new Map<string, RegisteredAccount>();
        for (const account of legacy) {
          const rec = await hashPassword(account.password as string);
          upgraded.set(
            account.email.toLowerCase(),
            withCredentials(account, rec.hash, rec.salt, account.passwordChangedAt ?? 0),
          );
        }
        if (cancelled) return;
        setState((s) => ({
          ...s,
          accounts: s.accounts.map((a) => upgraded.get(a.email.toLowerCase()) ?? a),
        }));
        console.log(`[Auth] Migrated ${upgraded.size} account(s) to hashed passwords`);
      } catch (error) {
        console.error("[Auth] Password hash migration failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeOnboarding = useCallback(() => {
    setState((s) => ({ ...s, onboarded: true }));
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const normalized = email.trim().toLowerCase();
    const account = findAccount(stateRef.current.accounts, normalized);
    if (!account) {
      return { ok: false, error: "not_found" };
    }
    const matches = await accountPasswordMatches(account, password);
    if (!matches) {
      return { ok: false, error: "wrong_password" };
    }
    // Opportunistic upgrade: a legacy plaintext account is re-stored as
    // a salted hash on its first successful sign-in.
    let upgraded: RegisteredAccount | null = null;
    if (!account.passwordHash || !account.passwordSalt) {
      const rec = await hashPassword(password);
      upgraded = withCredentials(account, rec.hash, rec.salt, account.passwordChangedAt ?? 0);
    }
    const s = stateRef.current;
    const active = upgraded ?? findAccount(s.accounts, normalized) ?? account;
    const next: PersistedState = {
      ...s,
      onboarded: true,
      lastEmail: active.email,
      accounts: upgraded
        ? s.accounts.map((a) => (a.email.toLowerCase() === normalized ? upgraded! : a))
        : s.accounts,
      user: profileFromAccount(active),
    };
    stateRef.current = next;
    setState(next);
    return { ok: true, error: null };
  }, []);

  const signInWithBiometric = useCallback((): AuthResult => {
    const s = stateRef.current;
    if (!s.lastEmail) {
      return { ok: false, error: "not_found" };
    }
    const account = findAccount(s.accounts, s.lastEmail);
    if (!account) {
      return { ok: false, error: "not_found" };
    }
    const next: PersistedState = {
      ...s,
      onboarded: true,
      user: profileFromAccount(account),
    };
    stateRef.current = next;
    setState(next);
    return { ok: true, error: null };
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string): Promise<AuthResult> => {
    const normalized = email.trim().toLowerCase();
    const existing = findAccount(stateRef.current.accounts, normalized);
    if (existing) {
      return { ok: false, error: "not_found" };
    }
    const rec = await hashPassword(password);
    const s = stateRef.current;
    const account: RegisteredAccount = {
      email: normalized,
      name: name.trim(),
      photo: null,
      passwordHash: rec.hash,
      passwordSalt: rec.salt,
      passwordChangedAt: Date.now(),
      createdAt: new Date().toISOString(),
      emailVerified: true,
    };
    const next: PersistedState = {
      ...s,
      onboarded: true,
      lastEmail: account.email,
      accounts: [...s.accounts, account],
      user: profileFromAccount(account),
    };
    stateRef.current = next;
    setState(next);
    return { ok: true, error: null };
  }, []);

  const signOut = useCallback(() => {
    const s = stateRef.current;
    const next: PersistedState = { ...s, user: null };
    stateRef.current = next;
    setState(next);
  }, []);

  const deleteAccount = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    const seed = freshSeed();
    stateRef.current = seed;
    setState(seed);
  }, []);

  const changePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    const s0 = stateRef.current;
    if (!s0.user) return false;
    const account = findAccount(s0.accounts, s0.user.email);
    if (!account) return false;
    // The current password must ALWAYS verify against the stored hash —
    // a wrong current password is never accepted.
    if (accountHasPassword(account)) {
      const ok = await accountPasswordMatches(account, current);
      if (!ok) return false;
    }
    const rec = await hashPassword(next);
    const changedAt = Date.now();
    const emailLower = account.email.toLowerCase();
    const s = stateRef.current;
    const nextState: PersistedState = {
      ...s,
      accounts: s.accounts.map((a) =>
        a.email.toLowerCase() === emailLower ? withCredentials(a, rec.hash, rec.salt, changedAt) : a,
      ),
      // Security: changing the password revokes every OTHER device
      // session — the current one stays signed in. Synced devices are
      // signed out via the "__account__" record on their next sync.
      sessions: s.sessions.filter((session) => session.current),
    };
    stateRef.current = nextState;
    setState(nextState);
    return true;
  }, []);

  const verifyAccountPassword = useCallback(async (password: string): Promise<boolean> => {
    const s = stateRef.current;
    if (!s.user) return false;
    const account = findAccount(s.accounts, s.user.email);
    if (!account) return false;
    return accountPasswordMatches(account, password);
  }, []);

  const resetAccountPassword = useCallback(async (email: string, newPassword: string): Promise<boolean> => {
    const normalized = email.trim().toLowerCase();
    if (!findAccount(stateRef.current.accounts, normalized)) return false;
    const rec = await hashPassword(newPassword);
    const changedAt = Date.now();
    const s = stateRef.current;
    const nextState: PersistedState = {
      ...s,
      accounts: s.accounts.map((a) =>
        a.email.toLowerCase() === normalized ? withCredentials(a, rec.hash, rec.salt, changedAt) : a,
      ),
    };
    stateRef.current = nextState;
    setState(nextState);
    return true;
  }, []);

  const revokeSession = useCallback((id: string) => {
    setState((s) => ({ ...s, sessions: s.sessions.filter((session) => session.id !== id) }));
  }, []);

  const signOutAllDevices = useCallback(() => {
    const s = stateRef.current;
    const next: PersistedState = { ...s, user: null, sessions: [] };
    stateRef.current = next;
    setState(next);
  }, []);

  const verifyEmail = useCallback(() => {
    setState((s) => {
      if (!s.user) return s;
      const accounts = s.accounts.map((a) =>
        a.email.toLowerCase() === s.user!.email.toLowerCase() ? { ...a, emailVerified: true } : a,
      );
      return { ...s, user: { ...s.user, emailVerified: true }, accounts };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  /* ---- App lock state & lifecycle ---- */
  const [locked, setLocked] = useState<boolean>(false);
  const [pinConfigured, setPinConfigured] = useState<boolean>(false);
  // Timestamp (ms) of the last time the app went to the background.
  const backgroundedAtRef = useRef<number | null>(null);

  // On mount and whenever the user changes, sync the PIN-configured flag from
  // secure storage and apply the privacy screen to match the saved setting.
  useEffect(() => {
    let active = true;
    void (async () => {
      const has = await hasPin();
      if (active) setPinConfigured(has);
    })();
    return () => {
      active = false;
    };
  }, [state.user?.email]);

  // Keep the native privacy screen in sync with the saved preference.
  useEffect(() => {
    void setPrivacyScreen(state.security.hideInAppSwitcher);
  }, [state.security.hideInAppSwitcher]);

  const appLockEnabled =
    state.security.biometricEnabled || state.security.pinEnabled;

  const lockApp = useCallback(() => {
    setLocked(true);
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<BiometricAuthOutcome> => {
    const outcome = await authenticateWithBiometry("Unlock LifeVault");
    if (outcome.ok) setLocked(false);
    return outcome;
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const ok = await verifyPin(pin);
    if (ok) setLocked(false);
    return ok;
  }, []);

  const setAppPin = useCallback(async (pin: string) => {
    await secureSetPin(pin);
    setPinConfigured(true);
    setState((s) => ({
      ...s,
      security: { ...s.security, pinEnabled: true },
    }));
  }, []);

  const removeAppPin = useCallback(async () => {
    await clearPin();
    setPinConfigured(false);
    setState((s) => ({
      ...s,
      security: { ...s.security, pinEnabled: false },
    }));
  }, []);

  const updateSecurity = useCallback((patch: Partial<SecuritySettings>) => {
    setState((s) => ({ ...s, security: { ...s.security, ...patch } }));
  }, []);

  const noteBackgrounded = useCallback(() => {
    backgroundedAtRef.current = Date.now();
  }, []);

  const noteForegrounded = useCallback(() => {
    const s = stateRef.current;
    if (!s.security.biometricEnabled && !s.security.pinEnabled) {
      backgroundedAtRef.current = null;
      return;
    }
    const bgAt = backgroundedAtRef.current;
    backgroundedAtRef.current = null;
    if (bgAt === null) return;
    const delay = s.security.autoLockDelay;
    // null = never auto-lock; otherwise delay is seconds (0 = immediate).
    if (delay === null) return;
    const elapsedSec = (Date.now() - bgAt) / 1000;
    if (elapsedSec >= delay) {
      setLocked(true);
    }
  }, []);

  // When the app first launches and a lock method is enabled, show the lock
  // screen so the user must authenticate before seeing any data.
  useEffect(() => {
    if (appLockEnabled && state.user) {
      setLocked(true);
    }
    // Only on initial mount — we don't want to re-lock on every settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the legacy settings.biometric flag in sync with security so the
  // existing sign-in Face ID button keeps working.
  useEffect(() => {
    if (state.settings.biometric !== state.security.biometricEnabled) {
      setState((s) => ({
        ...s,
        settings: { ...s.settings, biometric: s.security.biometricEnabled },
      }));
    }
  }, [state.security.biometricEnabled]);

  const updateUser = useCallback((patch: Partial<UserProfile>) => {
    const s = stateRef.current;
    if (!s.user) return;
    const updatedUser: UserProfile = { ...s.user, ...patch };
    // Keep the account registry in sync with name/photo/email/verified changes.
    const accounts = s.accounts.map((a) =>
      a.email.toLowerCase() === s.user.email.toLowerCase()
        ? {
            ...a,
            name: updatedUser.name,
            email: updatedUser.email,
            photo: updatedUser.photo,
            emailVerified: updatedUser.emailVerified,
          }
        : a,
    );
    const next: PersistedState = { ...s, user: updatedUser, accounts, lastEmail: updatedUser.email };
    stateRef.current = next;
    setState(next);
  }, []);

  const addDocument = useCallback((doc: Omit<VaultDocument, "id" | "createdAt">) => {
    setState((s) => ({
      ...s,
      documents: [{ ...doc, id: uid("doc"), createdAt: new Date().toISOString() }, ...s.documents],
    }));
  }, []);

  const updateDocument = useCallback((id: string, patch: Partial<VaultDocument>) => {
    setState((s) => ({
      ...s,
      documents: s.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }, []);

  const deleteDocument = useCallback((id: string) => {
    setState((s) => ({ ...s, documents: s.documents.filter((d) => d.id !== id) }));
  }, []);

  const addExpense = useCallback((expense: Omit<Expense, "id">) => {
    setState((s) => ({ ...s, expenses: [{ ...expense, id: uid("exp") }, ...s.expenses] }));
  }, []);

  const updateExpense = useCallback((id: string, patch: Partial<Expense>) => {
    setState((s) => ({
      ...s,
      expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
  }, []);

  const addSubscription = useCallback((sub: Omit<Subscription, "id">) => {
    setState((s) => ({ ...s, subscriptions: [{ ...sub, id: uid("sub") }, ...s.subscriptions] }));
  }, []);

  const updateSubscription = useCallback((id: string, patch: Partial<Subscription>) => {
    setState((s) => ({
      ...s,
      subscriptions: s.subscriptions.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)),
    }));
  }, []);

  const deleteSubscription = useCallback((id: string) => {
    setState((s) => ({ ...s, subscriptions: s.subscriptions.filter((sub) => sub.id !== id) }));
  }, []);

  const addAppointment = useCallback((apt: Omit<Appointment, "id">) => {
    setState((s) => ({ ...s, appointments: [{ ...apt, id: uid("apt") }, ...s.appointments] }));
  }, []);

  const updateAppointment = useCallback((id: string, patch: Partial<Appointment>) => {
    setState((s) => ({
      ...s,
      appointments: s.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }, []);

  const deleteAppointment = useCallback((id: string) => {
    setState((s) => ({ ...s, appointments: s.appointments.filter((a) => a.id !== id) }));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setState((s) => ({
      ...s,
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    }));
  }, []);

  const applyRestoredRecords = useCallback((rawRecords: RestoredRecord[]) => {
    // Old cloud backups may still contain pre-release demo rows — never
    // let a restore re-introduce them.
    const records = rawRecords.filter((r) => !DEMO_RECORD_IDS.has(r.id));
    const docs: VaultDocument[] = [];
    const exps: Expense[] = [];
    const subs: Subscription[] = [];
    const apts: Appointment[] = [];
    const notifs: AppNotification[] = [];
    let settings = state.settings;
    let security = state.security;
    for (const r of records) {
      if (r.deletedAt) continue;
      switch (r.kind) {
        case "document":
          if (r.data && typeof r.data === "object") docs.push(r.data as VaultDocument);
          break;
        case "expense":
          if (r.data && typeof r.data === "object") exps.push(r.data as Expense);
          break;
        case "subscription":
          if (r.data && typeof r.data === "object") subs.push(r.data as Subscription);
          break;
        case "appointment":
          if (r.data && typeof r.data === "object") apts.push(r.data as Appointment);
          break;
        case "notification":
          if (r.data && typeof r.data === "object") notifs.push(r.data as AppNotification);
          break;
        case "settings":
          if (r.data && typeof r.data === "object") settings = { ...settings, ...(r.data as Partial<Settings>) };
          break;
        case "security":
          if (r.data && typeof r.data === "object") security = { ...security, ...(r.data as Partial<SecuritySettings>) };
          break;
        default:
          break;
      }
    }
    setState((s) => ({
      ...s,
      documents: docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      expenses: exps.sort((a, b) => b.date.localeCompare(a.date)),
      subscriptions: subs,
      appointments: apts.sort((a, b) => b.date.localeCompare(a.date)),
      notifications: notifs.sort((a, b) => b.date.localeCompare(a.date)),
      settings,
      security,
    }));
  }, [state.settings, state.security]);

  const mergeRestoredRecords = useCallback((rawRecords: RestoredRecord[]) => {
    // Demo rows lingering in old cloud backups must never sync back in.
    const records = rawRecords.filter((r) => !DEMO_RECORD_IDS.has(r.id));
    if (records.length === 0) return;

    // Account credentials sync separately from vault data: a password
    // changed on another device is applied here, and — when it affects
    // the signed-in user — THIS device is signed out so the new
    // password is required (the encrypted backup is the source of
    // truth for credential changes).
    for (const record of records) {
      if (record.kind !== "account") continue;
      if (record.deletedAt || !record.data || typeof record.data !== "object") continue;
      const cred = record.data as Partial<SyncedAccountCredentials>;
      if (
        typeof cred.email !== "string" ||
        typeof cred.passwordHash !== "string" ||
        typeof cred.passwordSalt !== "string" ||
        typeof cred.passwordChangedAt !== "number" ||
        cred.passwordHash.length === 0 ||
        cred.passwordSalt.length === 0
      ) {
        continue;
      }
      const emailLower = cred.email.toLowerCase();
      const nextHash = cred.passwordHash;
      const nextSalt = cred.passwordSalt;
      const nextChangedAt = cred.passwordChangedAt;
      const s = stateRef.current;
      const account = s.accounts.find((a) => a.email.toLowerCase() === emailLower);
      if (!account) continue;
      const localChangedAt = account.passwordChangedAt ?? 0;
      if (nextChangedAt <= localChangedAt || nextHash === account.passwordHash) continue;
      const affectsCurrentUser = (s.user?.email ?? "").toLowerCase() === emailLower;
      console.log("[Auth] Applying password change from another device");
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) =>
          a.email.toLowerCase() === emailLower
            ? {
                ...a,
                passwordHash: nextHash,
                passwordSalt: nextSalt,
                passwordChangedAt: nextChangedAt,
                password: undefined,
              }
            : a,
        ),
        user: affectsCurrentUser ? null : prev.user,
      }));
      if (affectsCurrentUser) {
        toast.info("Your password was changed on another device", {
          description: "Sign in again with your new password.",
        });
      }
    }

    setState((s) => {
      const docs = new Map(s.documents.map((d) => [d.id, d]));
      const exps = new Map(s.expenses.map((e) => [e.id, e]));
      const subs = new Map(s.subscriptions.map((x) => [x.id, x]));
      const apts = new Map(s.appointments.map((a) => [a.id, a]));
      const notifs = new Map(s.notifications.map((n) => [n.id, n]));
      let settings = s.settings;
      let security = s.security;
      for (const r of records) {
        const isDeleted = r.deletedAt !== null && r.deletedAt !== undefined;
        const hasData = !isDeleted && r.data !== null && typeof r.data === "object";
        switch (r.kind) {
          case "document":
            if (isDeleted) docs.delete(r.id);
            else if (hasData) docs.set(r.id, r.data as VaultDocument);
            break;
          case "expense":
            if (isDeleted) exps.delete(r.id);
            else if (hasData) exps.set(r.id, r.data as Expense);
            break;
          case "subscription":
            if (isDeleted) subs.delete(r.id);
            else if (hasData) subs.set(r.id, r.data as Subscription);
            break;
          case "appointment":
            if (isDeleted) apts.delete(r.id);
            else if (hasData) apts.set(r.id, r.data as Appointment);
            break;
          case "notification":
            if (isDeleted) notifs.delete(r.id);
            else if (hasData) notifs.set(r.id, r.data as AppNotification);
            break;
          case "settings":
            if (hasData) settings = { ...settings, ...(r.data as Partial<Settings>) };
            break;
          case "security":
            if (hasData) security = { ...security, ...(r.data as Partial<SecuritySettings>) };
            break;
          default:
            break;
        }
      }
      return {
        ...s,
        documents: [...docs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        expenses: [...exps.values()].sort((a, b) => b.date.localeCompare(a.date)),
        subscriptions: [...subs.values()],
        appointments: [...apts.values()].sort((a, b) => b.date.localeCompare(a.date)),
        notifications: [...notifs.values()].sort((a, b) => b.date.localeCompare(a.date)),
        settings,
        security,
      };
    });
  }, []);

  const clearLocalData = useCallback(() => {
    setState((s) => ({
      ...s,
      documents: [],
      expenses: [],
      subscriptions: [],
      appointments: [],
      notifications: [],
    }));
  }, []);

  const unreadCount = useMemo(
    () => state.notifications.filter((n) => !n.read).length,
    [state.notifications],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      completeOnboarding,
      signIn,
      signInWithBiometric,
      signUp,
      signOut,
      deleteAccount,
      updateSettings,
      updateSecurity,
      updateUser,
      changePassword,
      verifyAccountPassword,
      resetAccountPassword,
      revokeSession,
      signOutAllDevices,
      verifyEmail,
      // App lock
      locked,
      appLockEnabled,
      lockApp,
      unlockWithBiometric,
      unlockWithPin,
      setAppPin,
      removeAppPin,
      pinConfigured,
      noteBackgrounded,
      noteForegrounded,
      addDocument,
      updateDocument,
      deleteDocument,
      addExpense,
      updateExpense,
      deleteExpense,
      addSubscription,
      updateSubscription,
      deleteSubscription,
      addAppointment,
      updateAppointment,
      deleteAppointment,
      markNotificationRead,
      markAllNotificationsRead,
      unreadCount,
      applyRestoredRecords,
      mergeRestoredRecords,
      clearLocalData,
    }),
    [
      state,
      completeOnboarding,
      signIn,
      signInWithBiometric,
      signUp,
      signOut,
      deleteAccount,
      updateSettings,
      updateSecurity,
      updateUser,
      changePassword,
      verifyAccountPassword,
      resetAccountPassword,
      revokeSession,
      signOutAllDevices,
      verifyEmail,
      locked,
      appLockEnabled,
      lockApp,
      unlockWithBiometric,
      unlockWithPin,
      setAppPin,
      removeAppPin,
      pinConfigured,
      noteBackgrounded,
      noteForegrounded,
      addDocument,
      updateDocument,
      deleteDocument,
      addExpense,
      updateExpense,
      deleteExpense,
      addSubscription,
      updateSubscription,
      deleteSubscription,
      addAppointment,
      updateAppointment,
      deleteAppointment,
      markNotificationRead,
      markAllNotificationsRead,
      unreadCount,
      applyRestoredRecords,
      mergeRestoredRecords,
      clearLocalData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
