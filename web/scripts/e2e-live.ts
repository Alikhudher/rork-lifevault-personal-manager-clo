/**
 * LIVE end-to-end test for LifeVault's account security + cloud backup.
 *
 * Exercises the app's EXACT production modules (account-recovery.ts,
 * crypto.ts, sync.ts, supabase.ts) against the real Supabase project
 * and real Brevo email delivery — no mocks. Covers:
 *
 *   flowA   Login screen "Forgot Password" — real code send, wrong code
 *           rejected, correct code verified, new password sign-in.
 *   flowB   Profile → Change Password → "Forgot password?" — same
 *           server path, second real send + verify + password.
 *   flowC1  Cloud backup setup: encrypted upload, fresh-device unlock,
 *           restore with data equality.
 *   flowC2  Backup password reset (sends the third real code), data
 *           re-encrypted, unlock with new password, old rejected,
 *           truthful unlock diagnoses (wrong password vs no backup).
 *   neg     No-false-success guards: invalid recipient reports the real
 *           server error; unsigned mailer-hook calls are rejected.
 *   cleanup Deletes the three test accounts + their cloud rows.
 *   report  Prints every recorded check and exits 1 on any failure.
 *
 * Test recipients are aliases of the account owner's Gmail (+lv.b12.*)
 * so every code physically lands in the real inbox as proof.
 *
 * Usage: cd web && E2E_SERVICE_ROLE_KEY=… bun scripts/e2e-live.ts <phase>
 * The service-role key is used ONLY to mint verification OTPs for
 * automated checking and to delete the test users afterwards. It is
 * never written to disk by this script.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  alignCloudPasswordAfterReset,
  finishVerifiedSession,
  requestEmailCode,
  verifyCloudPassword,
  verifyEmailCode,
} from "../src/lib/account-recovery";
import { deriveKey, setSessionKey } from "../src/lib/crypto";
import {
  backupAll,
  cloudBackupExistsForEmail,
  describeUnlockFailure,
  fetchSalt,
  initCloudSalt,
  restoreAll,
  wipeCloudRecords,
  type VaultRecord,
} from "../src/lib/sync";
import { getSupabase } from "../src/lib/supabase";

const STATE_PATH = "/tmp/lv-e2e-b12.json";

const EMAILS = {
  a: "alikhudher25+lv.b12.a@gmail.com",
  b: "alikhudher25+lv.b12.b@gmail.com",
  c: "alikhudher25+lv.b12.c@gmail.com",
  none: "alikhudher25+lv.b12.none@gmail.com",
} as const;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface E2EState {
  /** email → auth user id, for cleanup. */
  users: Record<string, string>;
  /** flow key → ms timestamp taken just before the send (delivery polling). */
  sentAt: Record<string, number>;
  pw: { a: string; b: string; c1: string; c2: string };
  checks: Check[];
}

function loadState(): E2EState {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as E2EState;
  }
  const rand = crypto.randomUUID().slice(0, 8);
  return {
    users: {},
    sentAt: {},
    pw: { a: `LvA!x${rand}`, b: `LvB!x${rand}`, c1: `LvC1!x${rand}`, c2: `LvC2!x${rand}` },
    checks: [],
  };
}

function saveState(state: E2EState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

let phaseFailed = false;

function check(state: E2EState, name: string, ok: boolean, detail: string): void {
  state.checks = state.checks.filter((c) => c.name !== name);
  state.checks.push({ name, ok, detail });
  if (!ok) phaseFailed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}

function adminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.E2E_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("VITE_SUPABASE_URL and E2E_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Mints a REAL GoTrue OTP for the address so the emailed-code path can
 * be verified automatically (we cannot read the Gmail inbox from here).
 * The minted code goes through the very same server-side verification
 * endpoint as the emailed one.
 */
async function mintOtp(email: string): Promise<{ otp: string; userId: string }> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const otp = data.properties?.email_otp ?? "";
  const userId = data.user?.id ?? "";
  if (!otp || !userId) throw new Error("generateLink returned no email_otp/user");
  return { otp, userId };
}

/** Distinctive encrypted payloads so restore equality is provable. */
function sampleRecords(tag: string): VaultRecord[] {
  const now = Date.now();
  return [
    {
      id: "doc_e2e_1",
      kind: "document",
      data: { id: "doc_e2e_1", title: `Passport ${tag}`, secret: `s-${tag}-1` },
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: "exp_e2e_1",
      kind: "expense",
      data: { id: "exp_e2e_1", title: `Groceries ${tag}`, amount: 42.5 },
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: "__settings__",
      kind: "settings",
      data: { theme: "dark", tag },
      updatedAt: now,
      deletedAt: null,
    },
  ];
}

/**
 * Mirrors the app's Unlock Cloud Backup flow exactly:
 * sign in → fetch salt → derive key → restore + decrypt.
 */
async function unlockAndRestore(
  email: string,
  password: string,
): Promise<{ ok: boolean; records: VaultRecord[]; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, records: [], error: "getSupabase() returned null" };
  await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
  setSessionKey(null);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, records: [], error: error.message };
  const saltRes = await fetchSalt();
  if (!saltRes.ok || !saltRes.salt) {
    return { ok: false, records: [], error: saltRes.error ?? "no salt stored" };
  }
  setSessionKey(await deriveKey(password, saltRes.salt));
  const res = await restoreAll();
  return { ok: res.ok && !res.disabled, records: res.records, error: res.error };
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

/** Login screen Forgot Password (mirrors pages/auth/ForgotPassword.tsx). */
async function flowA(state: E2EState): Promise<void> {
  const email = EMAILS.a;
  state.sentAt.a = Date.now();
  const send = await requestEmailCode(email);
  check(
    state,
    "A1 login-forgot: verification code send accepted by the server",
    send.ok === true,
    send.ok ? "requestEmailCode → ok (Auth 200, Brevo accepted)" : send.error,
  );
  if (send.ok === false) return;

  const wrong = await verifyEmailCode(email, "000000");
  check(
    state,
    "A2 login-forgot: wrong code rejected server-side",
    wrong.ok === false && wrong.code === "invalid_code",
    wrong.ok === false ? wrong.error : "unexpected success for wrong code",
  );

  const { otp, userId } = await mintOtp(email);
  state.users[email] = userId;
  const verified = await verifyEmailCode(email, otp);
  check(
    state,
    "A3 login-forgot: correct 6-digit code verifies",
    verified.ok === true,
    verified.ok ? "verifyOtp → server session established" : verified.error,
  );
  if (verified.ok === false) return;

  await alignCloudPasswordAfterReset(verified.session, state.pw.a);
  await finishVerifiedSession(verified.session);

  const login = await verifyCloudPassword(email, state.pw.a);
  check(
    state,
    "A4 login-forgot: sign-in works with the NEW password",
    login.ok === true,
    login.ok ? "signInWithPassword accepted the new password" : login.error,
  );

  const bad = await verifyCloudPassword(email, "Totally-wrong-9!");
  check(
    state,
    "A5 login-forgot: wrong password still rejected after reset",
    bad.ok === false && bad.code === "wrong_password",
    bad.ok === false ? bad.error : "unexpected success for wrong password",
  );
}

/** Profile → Change Password → Forgot password? (mirrors AccountSheets.tsx). */
async function flowB(state: E2EState): Promise<void> {
  const email = EMAILS.b;
  state.sentAt.b = Date.now();
  const send = await requestEmailCode(email);
  check(
    state,
    "B1 profile-forgot: verification code send accepted by the server",
    send.ok === true,
    send.ok ? "requestEmailCode → ok (same path as Change Password sheet)" : send.error,
  );
  if (send.ok === false) return;

  const { otp, userId } = await mintOtp(email);
  state.users[email] = userId;
  const verified = await verifyEmailCode(email, otp);
  check(
    state,
    "B2 profile-forgot: code verifies",
    verified.ok === true,
    verified.ok ? "verifyOtp → server session established" : verified.error,
  );
  if (verified.ok === false) return;

  await alignCloudPasswordAfterReset(verified.session, state.pw.b);
  await finishVerifiedSession(verified.session);

  const login = await verifyCloudPassword(email, state.pw.b);
  check(
    state,
    "B3 profile-forgot: sign-in works with the NEW password",
    login.ok === true,
    login.ok ? "signInWithPassword accepted the new password" : login.error,
  );
}

/** Cloud backup setup + unlock + restore (mirrors SyncContext + sync.ts). */
async function flowC1(state: E2EState): Promise<void> {
  const email = EMAILS.c;
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: state.pw.c1,
    email_confirm: true,
  });
  if (error || !data.user) {
    check(state, "C1 backup: test account created", false, error?.message ?? "no user returned");
    return;
  }
  state.users[email] = data.user.id;
  check(state, "C1 backup: test account created", true, "confirmed cloud identity");

  const sb = getSupabase();
  if (!sb) {
    check(state, "C2 backup: first-time setup", false, "getSupabase() returned null");
    return;
  }
  const { error: siErr } = await sb.auth.signInWithPassword({ email, password: state.pw.c1 });
  if (siErr) {
    check(state, "C2 backup: first-time setup", false, siErr.message);
    return;
  }
  const saltRes = await fetchSalt();
  let salt = saltRes.salt;
  if (!salt) salt = (await initCloudSalt()).salt;
  check(state, "C2 backup: first-time setup (salt created & stored)", Boolean(salt), salt ? "sync_state.salt set" : "salt creation failed");
  if (!salt) return;
  setSessionKey(await deriveKey(state.pw.c1, salt));

  const up = await backupAll(sampleRecords("v1"));
  check(
    state,
    "C3 backup: client-side encrypted upload",
    up.ok === true && up.disabled === false && up.uploaded === 3,
    up.ok === true && up.disabled === false ? `uploaded ${up.uploaded} encrypted records` : JSON.stringify(up),
  );

  const r = await unlockAndRestore(email, state.pw.c1);
  const doc = r.records.find((x) => x.id === "doc_e2e_1")?.data as { secret?: string } | undefined;
  check(
    state,
    "C4 backup: fresh unlock + restore decrypts identical data",
    r.ok && r.records.length === 3 && doc?.secret === "s-v1-1",
    r.error ?? `restored ${r.records.length} records, payload intact`,
  );
}

/** Backup password reset with emailed code (mirrors BackupSync.tsx reset sheet). */
async function flowC2(state: E2EState): Promise<void> {
  const email = EMAILS.c;
  state.sentAt.c = Date.now();
  const send = await requestEmailCode(email);
  check(
    state,
    "C5 backup-reset: verification code send accepted by the server",
    send.ok === true,
    send.ok ? "requestEmailCode → ok (same path as the backup reset sheet)" : send.error,
  );
  if (send.ok === false) return;

  const { otp } = await mintOtp(email);
  const verified = await verifyEmailCode(email, otp);
  check(
    state,
    "C6 backup-reset: code verifies",
    verified.ok === true,
    verified.ok ? "verifyOtp → email ownership proven" : verified.error,
  );
  if (verified.ok === false) return;

  // Mirrors SyncContext.resetBackupPassword steps 1–6.
  let detail = "";
  let okReset = false;
  const { error: updErr } = await verified.session.client.auth.updateUser({ password: state.pw.c2 });
  if (updErr) {
    detail = `updateUser: ${updErr.message}`;
  } else {
    const sb = getSupabase();
    const { error: siErr } = await sb!.auth.signInWithPassword({ email, password: state.pw.c2 });
    if (siErr) {
      detail = `post-reset sign-in: ${siErr.message}`;
    } else {
      const wiped = await wipeCloudRecords();
      const created = wiped.ok ? await initCloudSalt() : { salt: null };
      if (!created.salt) {
        detail = "old-record wipe or salt rotation failed";
      } else {
        setSessionKey(await deriveKey(state.pw.c2, created.salt));
        const up = await backupAll(sampleRecords("v2"));
        okReset = up.ok === true && up.disabled === false && up.uploaded === 3;
        detail = okReset
          ? "password set, old rows wiped, salt rotated, data re-encrypted & uploaded"
          : JSON.stringify(up);
      }
    }
  }
  await finishVerifiedSession(verified.session);
  check(state, "C7 backup-reset: reset completes end-to-end", okReset, detail);

  const r = await unlockAndRestore(email, state.pw.c2);
  const doc = r.records.find((x) => x.id === "doc_e2e_1")?.data as { secret?: string } | undefined;
  check(
    state,
    "C8 backup-reset: unlock + restore works with the NEW backup password",
    r.ok && r.records.length === 3 && doc?.secret === "s-v2-1",
    r.error ?? `restored ${r.records.length} records re-encrypted under the new key`,
  );

  const old = await verifyCloudPassword(email, state.pw.c1);
  check(
    state,
    "C9 backup-reset: OLD backup password rejected (also gates Change Backup Password)",
    old.ok === false && old.code === "wrong_password",
    old.ok === false ? old.error : "unexpected success for the old password",
  );

  const exists = await cloudBackupExistsForEmail(email);
  const diag = describeUnlockFailure(exists);
  check(
    state,
    "C10 unlock diagnosis: wrong password → truthful 'backup exists, password incorrect'",
    exists === true && diag.code === "wrong_backup_password",
    diag.error,
  );

  const exists2 = await cloudBackupExistsForEmail(EMAILS.none);
  const diag2 = describeUnlockFailure(exists2);
  check(
    state,
    "C11 unlock diagnosis: unknown email → 'No cloud backup found for this email'",
    exists2 === false && diag2.code === "no_backup_found" && /No cloud backup found/i.test(diag2.error),
    diag2.error,
  );
}

/**
 * Single spaced send — mirrors a real user requesting ONE code (the
 * burst of three back-to-back sends above is a test artifact that can
 * trip Gmail's rate throttling; real usage sends one at a time).
 */
async function flowD(state: E2EState): Promise<void> {
  const email = "alikhudher25+lv.b12.d@gmail.com";
  state.sentAt.d = Date.now();
  const send = await requestEmailCode(email);
  check(
    state,
    "D1 spaced single send: verification code send accepted",
    send.ok === true,
    send.ok ? "requestEmailCode → ok" : send.error,
  );
  if (send.ok === false) return;
  const { otp, userId } = await mintOtp(email);
  state.users[email] = userId;
  const verified = await verifyEmailCode(email, otp);
  check(
    state,
    "D2 spaced single send: code verifies",
    verified.ok === true,
    verified.ok ? "verifyOtp → ok" : verified.error,
  );
  if (verified.ok === true) await finishVerifiedSession(verified.session);
}

/** No-false-success guards. */
async function neg(state: E2EState): Promise<void> {
  const bad = await requestEmailCode("lv-invalid@@bad");
  check(
    state,
    "N1 no-false-success: invalid recipient → real server error returned (never ok)",
    bad.ok === false && bad.error.length > 10 && !/\{\}/.test(bad.error),
    bad.ok === false ? bad.error : "unexpected success for invalid email",
  );

  const url = process.env.VITE_SUPABASE_URL ?? "";
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? "";
  const res = await fetch(`${url}/functions/v1/send-email`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anon, authorization: `Bearer ${anon}` },
    body: JSON.stringify({
      user: { email: "spoof@example.com" },
      email_data: { token: "123456", email_action_type: "magiclink" },
    }),
  });
  const text = await res.text();
  let rejected = res.status >= 400;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    rejected = rejected || Boolean(parsed.error);
  } catch {
    // Non-JSON body — status decides.
  }
  check(
    state,
    "N2 no-false-success: unsigned mailer-hook call rejected (no silent success)",
    rejected,
    `HTTP ${res.status} body=${text.slice(0, 120)}`,
  );
}

/** Remove the three test accounts + their cloud rows. */
async function cleanup(state: E2EState): Promise<void> {
  const admin = adminClient();
  const cId = state.users[EMAILS.c];
  if (cId) {
    await admin.from("vault_records").delete().eq("user_id", cId);
    await admin.from("sync_state").delete().eq("user_id", cId);
  }
  const entries = Object.entries(state.users);
  let deleted = 0;
  for (const [email, id] of entries) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      console.log(`  cleanup: deleting ${email} failed: ${error.message}`);
    } else {
      deleted++;
      delete state.users[email]; // re-runnable: only new users next time
    }
  }
  check(state, "Z1 cleanup: test accounts and cloud rows removed", deleted === entries.length, `${deleted}/${entries.length} test users deleted`);
}

function report(state: E2EState): void {
  const failed = state.checks.filter((c) => !c.ok);
  console.log("\n===== E2E REPORT =====");
  for (const c of state.checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  }
  console.log(`===== ${state.checks.length - failed.length}/${state.checks.length} checks passed =====`);
  if (failed.length > 0) phaseFailed = true;
}

const phase = process.argv[2] ?? "report";
const state = loadState();
console.log(`\n--- e2e-live: ${phase} ---`);
try {
  if (phase === "flowA") await flowA(state);
  else if (phase === "flowB") await flowB(state);
  else if (phase === "flowC1") await flowC1(state);
  else if (phase === "flowC2") await flowC2(state);
  else if (phase === "flowD") await flowD(state);
  else if (phase === "neg") await neg(state);
  else if (phase === "cleanup") await cleanup(state);
  else report(state);
} catch (err) {
  check(state, `${phase}: unexpected exception`, false, err instanceof Error ? err.message : String(err));
} finally {
  saveState(state);
}
process.exit(phaseFailed ? 1 : 0);
