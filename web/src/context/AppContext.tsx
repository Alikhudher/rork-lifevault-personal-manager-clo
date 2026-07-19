import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  seedAccounts,
  seedAppointments,
  seedDocuments,
  seedExpenses,
  seedNotifications,
  seedSessions,
  seedSubscriptions,
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
  /** Validates password against the account registry before signing in. */
  signIn: (email: string, password: string) => AuthResult;
  /** Convenience for Face ID unlock — skips password validation. */
  signInWithBiometric: () => AuthResult;
  signUp: (name: string, email: string, password: string) => AuthResult;
  signOut: () => void;
  deleteAccount: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateSecurity: (patch: Partial<SecuritySettings>) => void;
  updateUser: (patch: Partial<UserProfile>) => void;
  changePassword: (current: string, next: string) => boolean;
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
  /** Wipe all local data (used when disabling cloud backup). */
  clearLocalData: () => void;
}

/** A flat record as returned by the cloud sync engine. */
export interface RestoredRecord {
  id: string;
  kind: "document" | "expense" | "subscription" | "appointment" | "notification" | "settings" | "security" | "folder";
  data: unknown;
  updatedAt: number;
  deletedAt: number | null;
}

const AppContext = createContext<AppContextValue | null>(null);

function freshSeed(): PersistedState {
  return {
    onboarded: false,
    user: null,
    lastEmail: null,
    accounts: seedAccounts(),
    settings: DEFAULT_SETTINGS,
    security: { ...DEFAULT_SECURITY_SETTINGS },
    documents: seedDocuments(),
    expenses: seedExpenses(),
    subscriptions: seedSubscriptions(),
    appointments: seedAppointments(),
    notifications: seedNotifications(),
    sessions: seedSessions(),
  };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshSeed();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const seed = freshSeed();
    return {
      ...seed,
      ...parsed,
      settings: { ...seed.settings, ...parsed.settings, notifications: { ...seed.settings.notifications, ...parsed.settings?.notifications } },
      security: { ...seed.security, ...parsed.security },
      sessions: parsed.sessions && parsed.sessions.length > 0 ? parsed.sessions : seed.sessions,
      accounts: parsed.accounts && parsed.accounts.length > 0 ? parsed.accounts : seed.accounts,
      lastEmail: parsed.lastEmail ?? parsed.user?.email ?? null,
    };
  } catch (error) {
    console.error("Failed to load saved state, starting fresh", error);
    return freshSeed();
  }
}

/** Build a UserProfile session from a registered account. */
function profileFromAccount(account: RegisteredAccount): UserProfile {
  return {
    name: account.name,
    email: account.email,
    photo: account.photo,
    createdAt: account.createdAt,
    password: account.password,
    emailVerified: account.emailVerified,
  };
}

function findAccount(accounts: RegisteredAccount[], email: string): RegisteredAccount | undefined {
  return accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
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

  const completeOnboarding = useCallback(() => {
    setState((s) => ({ ...s, onboarded: true }));
  }, []);

  const signIn = useCallback((email: string, password: string): AuthResult => {
    const normalized = email.trim().toLowerCase();
    const s = stateRef.current;
    const account = findAccount(s.accounts, normalized);
    if (!account) {
      return { ok: false, error: "not_found" };
    }
    if (account.password !== password) {
      return { ok: false, error: "wrong_password" };
    }
    const next: PersistedState = {
      ...s,
      onboarded: true,
      lastEmail: account.email,
      user: profileFromAccount(account),
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

  const signUp = useCallback((name: string, email: string, password: string): AuthResult => {
    const normalized = email.trim().toLowerCase();
    const s = stateRef.current;
    const existing = findAccount(s.accounts, normalized);
    if (existing) {
      return { ok: false, error: "not_found" };
    }
    const account: RegisteredAccount = {
      email: normalized,
      name: name.trim(),
      photo: null,
      password,
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

  const changePassword = useCallback((current: string, next: string) => {
    const s = stateRef.current;
    if (!s.user) return false;
    // The current password must always match the registered account.
    const account = findAccount(s.accounts, s.user.email);
    if (!account || account.password !== current) return false;
    const updatedAccount: RegisteredAccount = { ...account, password: next };
    const nextState: PersistedState = {
      ...s,
      accounts: s.accounts.map((a) =>
        a.email.toLowerCase() === account.email.toLowerCase() ? updatedAccount : a,
      ),
      user: { ...s.user, password: next },
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

  const applyRestoredRecords = useCallback((records: RestoredRecord[]) => {
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
