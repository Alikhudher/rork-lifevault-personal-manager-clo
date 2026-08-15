/**
 * Comprehensive user-data verification test suite.
 * @vitest-environment jsdom
 *
 * Tests the EXISTING system without modifying any production code.
 * Uses the REAL crypto engine (AES-GCM, PBKDF2) and a mock Supabase
 * client that enforces user_id-based isolation (simulating RLS policies).
 *
 * Scenarios covered (per user's request):
 *   1. Create test user accounts + add normal user data (documents, expenses,
 *      calendar items, subscriptions, settings, notifications)
 *   2. Confirm data is saved to the correct user account
 *   3. Close and reopen the app (localStorage reload) → data is still there
 *   4. Sign out and sign back in → same data returns via cloud restore
 *   5. Backup/restore/sync works with the existing Supabase system
 *   6. One user CANNOT see another user's data (RLS enforcement)
 *   7. Tombstones propagate deletions across devices
 *   8. Wrong-password decryption fails gracefully
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  encryptRecord,
  decryptRecord,
  deriveKey,
  generateSalt,
  setSessionKey,
  hasSessionKey,
} from "@/lib/crypto";
import {
  backupAll,
  restoreAll,
  syncIncremental,
  describeUnlockFailure,
  cloudBackupExistsForEmail,
  type VaultRecord,
  type RestoreResult,
  type IncrementalSyncResult,
} from "@/lib/sync";
import type {
  VaultDocument,
  Expense,
  Subscription,
  Appointment,
  AppNotification,
  Settings,
  SecuritySettings,
} from "@/lib/types";
import { DEFAULT_SECURITY_SETTINGS } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────

interface VaultRecordRow {
  id: string;
  user_id: string;
  kind: string;
  ciphertext: string;
  iv: string;
  updated_at: number;
  deleted_at: number | null;
}

interface SyncStateRow {
  user_id: string;
  last_synced_at: number | null;
  last_backup_at: number | null;
  schema_version: number;
  salt: string | null;
}

interface MockUser {
  id: string;
  email: string;
  password: string;
}

// ─── Mock Supabase with RLS enforcement ──────────────────────────

/**
 * In-memory database that enforces user_id-based isolation,
 * mirroring the RLS policies in 0001_vault_backup_sync.sql:
 *   "using (user_id = auth.uid())"
 */
class MockDB {
  private records = new Map<string, VaultRecordRow>();
  private states = new Map<string, SyncStateRow>();
  private users = new Map<string, MockUser>();
  private currentUserId: string | null = null;

  reset() {
    this.records.clear();
    this.states.clear();
    this.users.clear();
    this.currentUserId = null;
  }

  registerUser(email: string, password: string): MockUser {
    const lower = email.toLowerCase();
    if (this.users.has(lower)) throw new Error("User already exists");
    const user: MockUser = {
      id: `user-${lower.replace(/[^a-z0-9]/g, "")}`,
      email: lower,
      password,
    };
    this.users.set(lower, user);
    return user;
  }

  signIn(email: string, password: string): MockUser | null {
    const lower = email.toLowerCase();
    const user = this.users.get(lower);
    if (!user || user.password !== password) return null;
    this.currentUserId = user.id;
    return user;
  }

  signOut() { this.currentUserId = null; }
  setSession(userId: string) { this.currentUserId = userId; }
  getCurrentUserId(): string | null { return this.currentUserId; }

  getRecords(filters?: { gt?: { column: string; value: number } }): VaultRecordRow[] {
    if (!this.currentUserId) return [];
    let rows = Array.from(this.records.values()).filter((r) => r.user_id === this.currentUserId);
    if (filters?.gt) {
      const col = filters.gt.column as keyof VaultRecordRow;
      rows = rows.filter((r) => (r[col] as number) > filters.gt!.value);
    }
    return rows;
  }

  countRecords(): number {
    if (!this.currentUserId) return 0;
    return Array.from(this.records.values()).filter(
      (r) => r.user_id === this.currentUserId && r.deleted_at === null,
    ).length;
  }

  getRecordSizes(): { ciphertext: string; iv: string }[] {
    if (!this.currentUserId) return [];
    return Array.from(this.records.values())
      .filter((r) => r.user_id === this.currentUserId)
      .map((r) => ({ ciphertext: r.ciphertext, iv: r.iv }));
  }

  upsertRecord(row: Partial<VaultRecordRow> & { id: string; user_id: string }) {
    if (!this.currentUserId) throw new Error("Not authenticated");
    if (row.user_id !== this.currentUserId) throw new Error("RLS violation");
    const key = `${row.user_id}:${row.id}`;
    this.records.set(key, {
      id: row.id,
      user_id: row.user_id,
      kind: row.kind ?? "unknown",
      ciphertext: row.ciphertext ?? "",
      iv: row.iv ?? "",
      updated_at: row.updated_at ?? Date.now(),
      deleted_at: row.deleted_at ?? null,
    });
  }

  deleteRecords() {
    if (!this.currentUserId) return;
    for (const [key, row] of this.records) {
      if (row.user_id === this.currentUserId) this.records.delete(key);
    }
  }

  getSyncState(): SyncStateRow | null {
    if (!this.currentUserId) return null;
    return this.states.get(this.currentUserId) ?? null;
  }

  upsertSyncState(row: Partial<SyncStateRow> & { user_id: string }) {
    if (!this.currentUserId) throw new Error("Not authenticated");
    if (row.user_id !== this.currentUserId) throw new Error("RLS violation");
    const existing = this.states.get(row.user_id);
    this.states.set(row.user_id, {
      user_id: row.user_id,
      last_synced_at: row.last_synced_at ?? existing?.last_synced_at ?? null,
      last_backup_at: row.last_backup_at ?? existing?.last_backup_at ?? null,
      schema_version: row.schema_version ?? existing?.schema_version ?? 1,
      salt: row.salt ?? existing?.salt ?? null,
    });
  }

  deleteSyncState() {
    if (!this.currentUserId) return;
    this.states.delete(this.currentUserId);
  }

  cloudBackupExists(email: string): boolean {
    const user = this.users.get(email.toLowerCase());
    if (!user) return false;
    const state = this.states.get(user.id);
    const hasSalt = state && state.salt && state.salt.length > 0;
    const hasRecords = Array.from(this.records.values()).some((r) => r.user_id === user.id);
    return Boolean(hasSalt || hasRecords);
  }

  getCloudBackupSize(): number {
    if (!this.currentUserId) return 0;
    return Array.from(this.records.values())
      .filter((r) => r.user_id === this.currentUserId)
      .reduce((sum, r) => sum + r.ciphertext.length + r.iv.length, 0);
  }

  getUserById(id: string): MockUser | undefined {
    return Array.from(this.users.values()).find((u) => u.id === id);
  }
}

let db: MockDB;

// ─── Simplified mock Supabase client ─────────────────────────────

function createThenable<T>(value: T): { then: (resolve: (val: T) => void) => void } {
  return {
    then: (resolve: (val: T) => void) => { resolve(value); },
  };
}

function createMockSupabaseClient() {
  return {
    auth: {
      getSession: async () => {
        const uid = db.getCurrentUserId();
        if (!uid) return { data: { session: null } };
        const user = db.getUserById(uid);
        return {
          data: {
            session: user ? { user: { id: user.id, email: user.email } } : null,
          },
        };
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const result = db.signIn(email, password);
        if (!result) return { error: { message: "Invalid login credentials", code: "invalid_credentials" } };
        return { error: null };
      },
      signUp: async ({ email, password }: { email: string; password: string }) => {
        try {
          const user = db.registerUser(email, password);
          db.setSession(user.id);
          return { data: { session: { user: { id: user.id, email: user.email } } }, error: null };
        } catch {
          const result = db.signIn(email, password);
          if (!result) return { data: {}, error: { message: "User already registered" } };
          return { data: { session: { user: { id: result.id, email: result.email } } }, error: null };
        }
      },
      signOut: async () => { db.signOut(); return { error: null }; },
    },
    from: (table: string) => ({
      select: (_cols?: string) => {
        const chain = {
          eq: (_col: string, _val: string) => chain,
          order: (_col: string, _opts: unknown) =>
            createThenable({ data: db.getRecords(), error: null }),
          gt: (col: string, value: number) =>
            createThenable({ data: db.getRecords({ gt: { column: col, value } }), error: null }),
          maybeSingle: async () => {
            if (table === "sync_state") return { data: db.getSyncState(), error: null };
            return { data: null, error: null };
          },
          is: (_col: string, _val: null) => chain,
          limit: () =>
            createThenable({ data: db.getRecordSizes(), error: null }),
          then: (resolve: (val: { count: number | null; error: null }) => void) => {
            resolve({ count: db.countRecords(), error: null });
          },
        };
        return chain;
      },
      upsert: async (row: Record<string, unknown>, _opts?: { onConflict?: string }) => {
        try {
          if (table === "vault_records") {
            db.upsertRecord(row as Partial<VaultRecordRow> & { id: string; user_id: string });
          } else if (table === "sync_state") {
            db.upsertSyncState(row as Partial<SyncStateRow> & { user_id: string });
          }
          return { error: null };
        } catch (err) {
          return { error: { message: err instanceof Error ? err.message : "Upsert failed" } };
        }
      },
      delete: () => ({
        eq: () => ({
          then: (resolve: (val: { error: null }) => void) => {
            if (table === "vault_records") db.deleteRecords();
            if (table === "sync_state") db.deleteSyncState();
            resolve({ error: null });
          },
        }),
      }),
    }),
    rpc: async (fn: string, params?: Record<string, unknown>) => {
      if (fn === "cloud_backup_exists") {
        return { data: db.cloudBackupExists(params?.p_email as string), error: null };
      }
      if (fn === "get_cloud_backup_size") {
        return { data: db.getCloudBackupSize(), error: null };
      }
      return { data: null, error: { message: `Unknown function: ${fn}` } };
    },
  };
}

// ─── Mock the supabase module ────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => createMockSupabaseClient(),
  getSupabaseSession: async () => {
    const uid = db.getCurrentUserId();
    if (!uid) return null;
    return { user: { id: uid } };
  },
  getSupabaseUserId: async () => db.getCurrentUserId(),
  supabaseConfigured: true,
  withTimeout: async <T>(p: Promise<T>) => p,
  REQUEST_TIMEOUT_MS: 30000,
}));

// ─── Test data factory ───────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  currency: "AUD",
  darkMode: false,
  biometric: false,
  monthlyBudget: 3800,
  language: "en",
  notifications: { documents: true, subscriptions: true, bills: true, appointments: true, budget: true },
};

function createUserData(): {
  documents: VaultDocument[];
  expenses: Expense[];
  subscriptions: Subscription[];
  appointments: Appointment[];
  notifications: AppNotification[];
  settings: Settings;
  security: SecuritySettings;
} {
  const today = new Date().toISOString();
  return {
    documents: [
      {
        id: "doc_passport_001",
        name: "Australian Passport",
        category: "Passport",
        issueDate: "2022-01-15",
        expiryDate: "2032-01-15",
        notes: "Passport number P1234567",
        reminderDays: 60,
        fileName: "passport_scan.pdf",
        fileKind: "pdf",
        fileData: null,
        createdAt: today,
      },
      {
        id: "doc_licence_001",
        name: "NSW Driver Licence",
        category: "Driver Licence",
        issueDate: "2024-06-01",
        expiryDate: "2029-06-01",
        notes: "Class C",
        reminderDays: 30,
        fileName: "licence_front.jpg",
        fileKind: "image",
        fileData: null,
        createdAt: today,
      },
    ],
    expenses: [
      {
        id: "exp_001",
        amount: 85.5,
        date: "2026-08-14T12:00:00.000Z",
        category: "Food",
        merchant: "Woolworths",
        notes: "Weekly groceries",
        paymentMethod: "Credit Card",
      },
      {
        id: "exp_002",
        amount: 60.0,
        date: "2026-08-13T08:00:00.000Z",
        category: "Fuel",
        merchant: "Shell",
        notes: "Full tank",
        paymentMethod: "Debit Card",
      },
      {
        id: "exp_003",
        amount: 1200.0,
        date: "2026-08-01T00:00:00.000Z",
        category: "Rent",
        merchant: "Ray White",
        notes: "Monthly rent",
        paymentMethod: "Bank Transfer",
      },
    ],
    subscriptions: [
      {
        id: "sub_netflix",
        name: "Netflix Standard",
        price: 22.99,
        frequency: "monthly",
        nextPaymentDate: "2026-09-01",
        category: "Entertainment",
        paymentMethod: "Credit Card",
        reminderDays: 7,
        status: "active",
      },
      {
        id: "sub_spotify",
        name: "Spotify Premium",
        price: 11.99,
        frequency: "monthly",
        nextPaymentDate: "2026-08-28",
        category: "Entertainment",
        paymentMethod: "Credit Card",
        reminderDays: 3,
        status: "active",
      },
    ],
    appointments: [
      {
        id: "apt_dentist",
        title: "Dentist Appointment",
        date: "2026-08-20",
        time: "14:30",
        location: "Smile Dental Clinic",
        notes: "6-monthly checkup",
        reminder: "1 day before",
      },
      {
        id: "apt_mechanic",
        title: "Car Service",
        date: "2026-08-25",
        time: "09:00",
        location: "AutoCare Centre",
        notes: "Oil change + inspection",
        reminder: "3 days before",
      },
    ],
    notifications: [
      {
        id: "notif_001",
        type: "document",
        title: "Passport expiry",
        message: "Your passport expires in 5 years",
        date: today,
        read: false,
      },
    ],
    settings: { ...DEFAULT_SETTINGS, monthlyBudget: 4200 },
    security: { ...DEFAULT_SECURITY_SETTINGS, pinEnabled: true, pinLength: 6 },
  };
}

/** Build the flat VaultRecord[] list (mirrors SyncContext.buildRecordSet). */
function buildRecordSet(data: ReturnType<typeof createUserData>): VaultRecord[] {
  const recs: VaultRecord[] = [];
  for (const d of data.documents) recs.push({ id: d.id, kind: "document", data: d, updatedAt: 0, deletedAt: null });
  for (const e of data.expenses) recs.push({ id: e.id, kind: "expense", data: e, updatedAt: 0, deletedAt: null });
  for (const s of data.subscriptions) recs.push({ id: s.id, kind: "subscription", data: s, updatedAt: 0, deletedAt: null });
  for (const a of data.appointments) recs.push({ id: a.id, kind: "appointment", data: a, updatedAt: 0, deletedAt: null });
  for (const n of data.notifications) recs.push({ id: n.id, kind: "notification", data: n, updatedAt: 0, deletedAt: null });
  recs.push({ id: "__settings__", kind: "settings", data: data.settings, updatedAt: 0, deletedAt: null });
  recs.push({ id: "__security__", kind: "security", data: data.security, updatedAt: 0, deletedAt: null });
  return recs;
}

function stampRecords(recs: VaultRecord[], ts: number): VaultRecord[] {
  return recs.map((r) => ({ ...r, updatedAt: ts }));
}

// ─── localStorage simulation ─────────────────────────────────────

const LS_KEY = "lifevault-state-v1";

function saveToLocalStorage(state: Record<string, unknown>) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadFromLocalStorage(): Record<string, unknown> | null {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("User Data Verification — Existing System", () => {
  let userA_key: CryptoKey;
  let userA_salt: string;
  let userB_key: CryptoKey;
  let userB_salt: string;

  beforeEach(async () => {
    db = new MockDB();
    localStorage.clear();
    setSessionKey(null);

    userA_salt = generateSalt();
    userA_key = await deriveKey("UserAPassword123!", userA_salt);

    userB_salt = generateSalt();
    userB_key = await deriveKey("UserBPassword456!", userB_salt);
  });

  afterEach(() => {
    setSessionKey(null);
    localStorage.clear();
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. CREATE USER ACCOUNT + ADD DATA → BACKUP TO CLOUD
  // ═══════════════════════════════════════════════════════════════

  describe("1. Create account + add user data + backup to cloud", () => {
    it("creates a user account in Supabase auth", () => {
      const userA = db.registerUser("usera@test.com", "UserAPassword123!");
      expect(userA.id).toBeDefined();
      expect(userA.email).toBe("usera@test.com");

      const userB = db.registerUser("userb@test.com", "UserBPassword456!");
      expect(userB.id).toBeDefined();
      expect(userB.email).toBe("userb@test.com");
      expect(userA.id).not.toBe(userB.id);
    });

    it("backs up all user data types to the cloud with real AES-GCM encryption", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now());

      const result = await backupAll(records, (done, total) => {
        expect(done).toBeLessThanOrEqual(total);
      });

      expect(result.ok).toBe(true);
      if (result.ok === true && result.disabled === false) {
        expect(result.uploaded).toBe(records.length);
      }

      const cloudRecords = db.getRecords();
      expect(cloudRecords.length).toBe(records.length);

      const kinds = new Set(cloudRecords.map((r) => r.kind));
      expect(kinds.has("document")).toBe(true);
      expect(kinds.has("expense")).toBe(true);
      expect(kinds.has("subscription")).toBe(true);
      expect(kinds.has("appointment")).toBe(true);
      expect(kinds.has("notification")).toBe(true);
      expect(kinds.has("settings")).toBe(true);
      expect(kinds.has("security")).toBe(true);

      // Verify ciphertext is NOT plaintext
      for (const row of cloudRecords) {
        expect(row.ciphertext.length).toBeGreaterThan(0);
        expect(row.iv.length).toBeGreaterThan(0);
        expect(row.ciphertext).not.toContain("Australian Passport");
        expect(row.ciphertext).not.toContain("Woolworths");
        expect(row.ciphertext).not.toContain("Netflix");
      }
    });

    it("saves data to the correct user account (user_id isolation)", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now());
      await backupAll(records);

      const userAId = db.getCurrentUserId()!;
      const cloudRecords = db.getRecords();
      for (const row of cloudRecords) {
        expect(row.user_id).toBe(userAId);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. CLOSE AND REOPEN THE APP → LOCAL DATA PERSISTS
  // ═══════════════════════════════════════════════════════════════

  describe("2. Close and reopen app — localStorage persistence", () => {
    it("data survives a page reload via localStorage", async () => {
      const userData = createUserData();

      saveToLocalStorage({
        onboarded: true,
        user: { name: "User A", email: "usera@test.com", photo: null, createdAt: new Date().toISOString(), emailVerified: true },
        lastEmail: "usera@test.com",
        accounts: [],
        settings: userData.settings,
        security: userData.security,
        documents: userData.documents,
        expenses: userData.expenses,
        subscriptions: userData.subscriptions,
        appointments: userData.appointments,
        notifications: userData.notifications,
        sessions: [],
      });

      const restored = loadFromLocalStorage();
      expect(restored).not.toBeNull();
      const r = restored!;

      // Documents
      const docs = r.documents as VaultDocument[];
      expect(docs.length).toBe(2);
      expect(docs[0].name).toBe("Australian Passport");
      expect(docs[0].category).toBe("Passport");
      expect(docs[0].expiryDate).toBe("2032-01-15");

      // Expenses
      const exps = r.expenses as Expense[];
      expect(exps.length).toBe(3);
      expect(exps[0].merchant).toBe("Woolworths");
      expect(exps[0].amount).toBe(85.5);

      // Subscriptions
      const subs = r.subscriptions as Subscription[];
      expect(subs.length).toBe(2);
      expect(subs[0].name).toBe("Netflix Standard");
      expect(subs[0].price).toBe(22.99);

      // Appointments
      const apts = r.appointments as Appointment[];
      expect(apts.length).toBe(2);
      expect(apts[0].title).toBe("Dentist Appointment");
      expect(apts[0].date).toBe("2026-08-20");

      // Settings
      const settings = r.settings as Settings;
      expect(settings.monthlyBudget).toBe(4200);
      expect(settings.currency).toBe("AUD");

      // Security
      const security = r.security as SecuritySettings;
      expect(security.pinEnabled).toBe(true);
      expect(security.pinLength).toBe(6);

      // Notifications
      const notifs = r.notifications as AppNotification[];
      expect(notifs.length).toBe(1);
      expect(notifs[0].type).toBe("document");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. SIGN OUT → SIGN BACK IN → DATA RETURNS VIA CLOUD RESTORE
  // ═══════════════════════════════════════════════════════════════

  describe("3. Sign out → sign back in → cloud restore", () => {
    it("full cycle: backup → sign out → sign in → restore → data matches", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const originalData = createUserData();
      const records = stampRecords(buildRecordSet(originalData), Date.now());
      const backupResult = await backupAll(records);
      expect(backupResult.ok).toBe(true);

      // Sign out
      db.signOut();
      setSessionKey(null);
      expect(hasSessionKey()).toBe(false);

      // Sign back in
      const signInResult = db.signIn("usera@test.com", "UserAPassword123!");
      expect(signInResult).not.toBeNull();

      const restoredKey = await deriveKey("UserAPassword123!", userA_salt);
      setSessionKey(restoredKey);
      expect(hasSessionKey()).toBe(true);

      // Restore
      const restoreResult: RestoreResult = await restoreAll();
      expect(restoreResult.ok).toBe(true);
      expect(restoreResult.disabled).toBe(false);
      expect(restoreResult.records.length).toBe(records.length);

      // Verify documents
      const restoredDocs = restoreResult.records.filter((r) => r.kind === "document");
      expect(restoredDocs.length).toBe(2);

      const passport = restoredDocs.find((r) => r.id === "doc_passport_001");
      expect(passport).toBeDefined();
      const passportData = passport!.data as VaultDocument;
      expect(passportData.name).toBe("Australian Passport");
      expect(passportData.category).toBe("Passport");
      expect(passportData.expiryDate).toBe("2032-01-15");
      expect(passportData.reminderDays).toBe(60);

      const licence = restoredDocs.find((r) => r.id === "doc_licence_001");
      expect(licence).toBeDefined();
      expect((licence!.data as VaultDocument).name).toBe("NSW Driver Licence");

      // Expenses
      const restoredExps = restoreResult.records.filter((r) => r.kind === "expense");
      expect(restoredExps.length).toBe(3);
      const groceries = restoredExps.find((r) => r.id === "exp_001");
      expect(groceries).toBeDefined();
      const grocData = groceries!.data as Expense;
      expect(grocData.amount).toBe(85.5);
      expect(grocData.merchant).toBe("Woolworths");
      expect(grocData.category).toBe("Food");

      // Subscriptions
      const restoredSubs = restoreResult.records.filter((r) => r.kind === "subscription");
      expect(restoredSubs.length).toBe(2);
      const netflix = restoredSubs.find((r) => r.id === "sub_netflix");
      expect(netflix).toBeDefined();
      const netflixData = netflix!.data as Subscription;
      expect(netflixData.name).toBe("Netflix Standard");
      expect(netflixData.price).toBe(22.99);
      expect(netflixData.frequency).toBe("monthly");

      // Appointments
      const restoredApts = restoreResult.records.filter((r) => r.kind === "appointment");
      expect(restoredApts.length).toBe(2);
      const dentist = restoredApts.find((r) => r.id === "apt_dentist");
      expect(dentist).toBeDefined();
      const dentistData = dentist!.data as Appointment;
      expect(dentistData.title).toBe("Dentist Appointment");
      expect(dentistData.date).toBe("2026-08-20");
      expect(dentistData.time).toBe("14:30");

      // Settings
      const settingsRec = restoreResult.records.find((r) => r.id === "__settings__");
      expect(settingsRec).toBeDefined();
      const settingsData = settingsRec!.data as Settings;
      expect(settingsData.monthlyBudget).toBe(4200);
      expect(settingsData.currency).toBe("AUD");
      expect(settingsData.language).toBe("en");

      // Security
      const securityRec = restoreResult.records.find((r) => r.id === "__security__");
      expect(securityRec).toBeDefined();
      const securityData = securityRec!.data as SecuritySettings;
      expect(securityData.pinEnabled).toBe(true);
      expect(securityData.pinLength).toBe(6);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. BACKUP / RESTORE / SYNC WITH EXISTING SUPABASE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  describe("4. Sync engine — incremental sync", () => {
    it("incremental sync pushes new records and pulls remote changes", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now());
      await backupAll(records);

      // Add a new expense
      const newExpense: Expense = {
        id: "exp_new_001",
        amount: 45.0,
        date: "2026-08-15T10:00:00.000Z",
        category: "Shopping",
        merchant: "Big W",
        notes: "New expense after sync",
        paymentMethod: "Cash",
      };

      const updatedRecords = [
        ...records,
        { id: newExpense.id, kind: "expense" as const, data: newExpense, updatedAt: Date.now() + 1000, deletedAt: null },
      ];

      const syncResult: IncrementalSyncResult = await syncIncremental(updatedRecords);
      expect(syncResult.ok).toBe(true);
      expect(syncResult.disabled).toBe(false);
      expect(syncResult.uploaded).toBeGreaterThanOrEqual(1);

      const cloudRecords = db.getRecords();
      const newRecordInCloud = cloudRecords.find((r) => r.id === "exp_new_001");
      expect(newRecordInCloud).toBeDefined();
    });

    it("incremental sync detects and applies remote changes (simulate another device)", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now() - 10000);
      await backupAll(records);

      // Simulate another device pushing a new record (timestamp must be > last_synced_at from backup)
      const remoteData = {
        id: "apt_remote_001",
        title: "Remote Appointment",
        date: "2026-09-01",
        time: "10:00",
        location: "Remote Location",
        notes: "Added from another device",
        reminder: "1 hour before",
      };
      const { ciphertext, iv } = await encryptRecord(userA_key, remoteData);
      db.upsertRecord({
        id: "apt_remote_001",
        user_id: db.getCurrentUserId()!,
        kind: "appointment",
        ciphertext,
        iv,
        updated_at: Date.now() + 5000,
        deleted_at: null,
      });

      const syncResult = await syncIncremental(records);
      expect(syncResult.ok).toBe(true);
      expect(syncResult.downloaded).toBeGreaterThanOrEqual(1);

      const remotePulled = syncResult.remoteNewer.find((r) => r.id === "apt_remote_001");
      expect(remotePulled).toBeDefined();
      const pulledData = remotePulled!.data as Appointment;
      expect(pulledData.title).toBe("Remote Appointment");
      expect(pulledData.location).toBe("Remote Location");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. ONE USER CANNOT SEE ANOTHER USER'S DATA (RLS)
  // ═══════════════════════════════════════════════════════════════

  describe("5. User isolation — one user cannot see another's data", () => {
    it("User A's cloud records are invisible to User B", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.registerUser("userb@test.com", "UserBPassword456!");

      // User A backs up data
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userAData = createUserData();
      const userARecords = stampRecords(buildRecordSet(userAData), Date.now());
      await backupAll(userARecords);

      const userACloudCount = db.getRecords().length;
      expect(userACloudCount).toBe(userARecords.length);

      // User B signs in
      db.signOut();
      setSessionKey(null);
      db.signIn("userb@test.com", "UserBPassword456!");
      setSessionKey(userB_key);

      // User B restores — should get ZERO records
      const userBRestore = await restoreAll();
      expect(userBRestore.ok).toBe(true);
      expect(userBRestore.records.length).toBe(0);

      // User B backs up their own data
      const userBData = createUserData();
      userBData.documents[0].name = "User B Passport";
      userBData.expenses[0].merchant = "User B Store";
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userB_salt });

      const userBRecords = stampRecords(buildRecordSet(userBData), Date.now());
      await backupAll(userBRecords);

      const userBCloudRecords = db.getRecords();
      expect(userBCloudRecords.length).toBe(userBRecords.length);

      // Verify User B's data is different from User A's
      const userBDocs = userBCloudRecords.filter((r) => r.kind === "document");
      expect(userBDocs.length).toBe(2);

      const userBPassport = userBDocs.find((r) => r.id === "doc_passport_001");
      expect(userBPassport).toBeDefined();
      const passportData = await decryptRecord<VaultDocument>(userB_key, {
        ciphertext: userBPassport!.ciphertext,
        iv: userBPassport!.iv,
      });
      expect(passportData.name).toBe("User B Passport");
      expect(passportData.name).not.toBe("Australian Passport");

      // User A signs back in
      db.signOut();
      setSessionKey(null);
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);

      const userARestore = await restoreAll();
      expect(userARestore.ok).toBe(true);
      expect(userARestore.records.length).toBe(userARecords.length);

      const userAPassport = userARestore.records.find(
        (r) => r.id === "doc_passport_001" && r.kind === "document",
      );
      expect(userAPassport).toBeDefined();
      const aPassportData = userAPassport!.data as VaultDocument;
      expect(aPassportData.name).toBe("Australian Passport");
      expect(aPassportData.name).not.toBe("User B Passport");
    });

    it("User B cannot decrypt User A's records even with direct access", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.registerUser("userb@test.com", "UserBPassword456!");

      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now());
      await backupAll(records);

      const userACloudRecords = db.getRecords();
      const passportRow = userACloudRecords.find((r) => r.id === "doc_passport_001");
      expect(passportRow).toBeDefined();

      // User B tries to decrypt with their own key
      let decryptSucceeded = false;
      try {
        await decryptRecord(userB_key, {
          ciphertext: passportRow!.ciphertext,
          iv: passportRow!.iv,
        });
        decryptSucceeded = true;
      } catch {
        // Expected — AES-GCM authentication tag fails with wrong key
      }
      expect(decryptSucceeded).toBe(false);
    });

    it("cloud_backup_exists correctly reports per-user backup status", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.registerUser("userb@test.com", "UserBPassword456!");

      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      expect(await cloudBackupExistsForEmail("usera@test.com")).toBe(true);
      expect(await cloudBackupExistsForEmail("userb@test.com")).toBe(false);
      expect(await cloudBackupExistsForEmail("nobody@test.com")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. TOMBSTONES — DELETIONS PROPAGATE ACROSS DEVICES
  // ═══════════════════════════════════════════════════════════════

  describe("6. Deletion propagation via tombstones", () => {
    it("deleted records are restored as tombstones on other devices", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now() - 10000);
      await backupAll(records);

      // Delete the Netflix subscription (timestamp must be > last_synced_at from backup)
      const deleteTime = Date.now() + 5000;
      const tombstone: VaultRecord = {
        id: "sub_netflix",
        kind: "subscription",
        data: null,
        updatedAt: deleteTime,
        deletedAt: deleteTime,
      };

      const syncResult = await syncIncremental([tombstone]);
      expect(syncResult.ok).toBe(true);

      // Sign out and sign back in (new device)
      db.signOut();
      setSessionKey(null);
      db.signIn("usera@test.com", "UserAPassword123!");
      const restoredKey = await deriveKey("UserAPassword123!", userA_salt);
      setSessionKey(restoredKey);

      const restoreResult = await restoreAll();
      expect(restoreResult.ok).toBe(true);

      const netflixRecord = restoreResult.records.find((r) => r.id === "sub_netflix");
      expect(netflixRecord).toBeDefined();
      expect(netflixRecord!.deletedAt).not.toBeNull();
      expect(netflixRecord!.deletedAt).toBe(deleteTime);

      // Other records should NOT be tombstoned
      const passportRecord = restoreResult.records.find((r) => r.id === "doc_passport_001");
      expect(passportRecord).toBeDefined();
      expect(passportRecord!.deletedAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. WRONG PASSWORD — GRACEFUL FAILURE
  // ═══════════════════════════════════════════════════════════════

  describe("7. Wrong password handling", () => {
    it("restore with wrong password fails gracefully", async () => {
      db.registerUser("usera@test.com", "UserAPassword123!");
      db.signIn("usera@test.com", "UserAPassword123!");
      setSessionKey(userA_key);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: userA_salt });

      const userData = createUserData();
      const records = stampRecords(buildRecordSet(userData), Date.now());
      await backupAll(records);

      db.signOut();
      setSessionKey(null);

      // Sign back in but derive key with WRONG password
      db.signIn("usera@test.com", "UserAPassword123!");
      const wrongKey = await deriveKey("WrongPassword999!", userA_salt);
      setSessionKey(wrongKey);

      const restoreResult = await restoreAll();
      expect(restoreResult.ok).toBe(false);
      expect(restoreResult.records.length).toBe(0);
      expect(restoreResult.error).toBeDefined();
      expect(restoreResult.error!).not.toContain("[object");
      expect(restoreResult.error!).not.toContain("undefined");
      expect(restoreResult.error!.length).toBeGreaterThan(20);
    });

    it("describeUnlockFailure gives correct messages for all states", () => {
      const noBackup = describeUnlockFailure(false);
      expect(noBackup.code).toBe("no_backup_found");
      expect(noBackup.error).toContain("No cloud backup found");

      const wrongPassword = describeUnlockFailure(true);
      expect(wrongPassword.code).toBe("wrong_backup_password");
      expect(wrongPassword.error.toLowerCase()).toContain("incorrect");

      const unknown = describeUnlockFailure(null);
      expect(unknown.code).toBeNull();
      expect(unknown.error).toContain("Incorrect email or backup password");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. EMPTY ACCOUNT — NEW USER WITH NO DATA
  // ═══════════════════════════════════════════════════════════════

  describe("8. Empty account — new user with no data", () => {
    it("restore on a fresh account returns empty array, not an error", async () => {
      db.registerUser("newuser@test.com", "NewPassword123!");
      db.signIn("newuser@test.com", "NewPassword123!");
      const newSalt = generateSalt();
      const newKey = await deriveKey("NewPassword123!", newSalt);
      setSessionKey(newKey);
      db.upsertSyncState({ user_id: db.getCurrentUserId()!, salt: newSalt });

      const restoreResult = await restoreAll();
      expect(restoreResult.ok).toBe(true);
      expect(restoreResult.records.length).toBe(0);
    });
  });
});
