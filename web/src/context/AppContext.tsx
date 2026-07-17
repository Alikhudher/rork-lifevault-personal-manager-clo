import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  seedAppointments,
  seedDocuments,
  seedExpenses,
  seedNotifications,
  seedSessions,
  seedSubscriptions,
} from "@/lib/mock-data";
import { uid } from "@/lib/format";
import type {
  AppNotification,
  Appointment,
  DeviceSession,
  Expense,
  Settings,
  Subscription,
  UserProfile,
  VaultDocument,
} from "@/lib/types";

const STORAGE_KEY = "lifevault-state-v1";

interface PersistedState {
  onboarded: boolean;
  user: UserProfile | null;
  settings: Settings;
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
  notifications: AppNotification[];
  sessions: DeviceSession[];
}

interface AppContextValue extends PersistedState {
  completeOnboarding: () => void;
  signIn: (email: string) => void;
  signUp: (name: string, email: string, password?: string) => void;
  signOut: () => void;
  deleteAccount: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateUser: (patch: Partial<UserProfile>) => void;
  changePassword: (current: string, next: string) => boolean;
  revokeSession: (id: string) => void;
  signOutAllDevices: () => void;
  verifyEmail: () => void;

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
}

const AppContext = createContext<AppContextValue | null>(null);

function freshSeed(): PersistedState {
  return {
    onboarded: false,
    user: null,
    settings: DEFAULT_SETTINGS,
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
      sessions: parsed.sessions && parsed.sessions.length > 0 ? parsed.sessions : seed.sessions,
    };
  } catch (error) {
    console.error("Failed to load saved state, starting fresh", error);
    return freshSeed();
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => loadState());

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

  const signIn = useCallback((email: string) => {
    setState((s) => ({
      ...s,
      onboarded: true,
      user: {
        name: s.user?.name && s.user.email === email ? s.user.name : "Mia Thompson",
        email,
        photo: s.user?.photo ?? null,
        createdAt: s.user?.createdAt ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 87).toISOString(),
        password: s.user?.password ?? null,
        emailVerified: s.user?.emailVerified ?? true,
      },
    }));
  }, []);

  const signUp = useCallback((name: string, email: string, password?: string) => {
    setState((s) => ({
      ...s,
      onboarded: true,
      user: {
        name,
        email,
        photo: null,
        createdAt: new Date().toISOString(),
        password: password ?? null,
        emailVerified: true,
      },
    }));
  }, []);

  const signOut = useCallback(() => {
    setState((s) => ({ ...s, user: null }));
  }, []);

  const deleteAccount = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(freshSeed());
  }, []);

  const changePassword = useCallback((current: string, next: string) => {
    let success = false;
    setState((s) => {
      if (!s.user) return s;
      // For the mock flow we allow the change when the current password matches
      // or when no password has been set yet (legacy accounts).
      if (s.user.password !== null && s.user.password !== current) return s;
      success = true;
      return { ...s, user: { ...s.user, password: next } };
    });
    return success;
  }, []);

  const revokeSession = useCallback((id: string) => {
    setState((s) => ({ ...s, sessions: s.sessions.filter((session) => session.id !== id) }));
  }, []);

  const signOutAllDevices = useCallback(() => {
    setState((s) => ({
      ...s,
      user: null,
      sessions: [],
    }));
  }, []);

  const verifyEmail = useCallback(() => {
    setState((s) => (s.user ? { ...s, user: { ...s.user, emailVerified: true } } : s));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const updateUser = useCallback((patch: Partial<UserProfile>) => {
    setState((s) => (s.user ? { ...s, user: { ...s.user, ...patch } } : s));
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

  const unreadCount = useMemo(
    () => state.notifications.filter((n) => !n.read).length,
    [state.notifications],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      completeOnboarding,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      updateSettings,
      updateUser,
      changePassword,
      revokeSession,
      signOutAllDevices,
      verifyEmail,
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
    }),
    [
      state,
      completeOnboarding,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      updateSettings,
      updateUser,
      changePassword,
      revokeSession,
      signOutAllDevices,
      verifyEmail,
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
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
