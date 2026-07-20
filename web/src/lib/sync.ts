/**
 * LifeVault sync engine.
 *
 * Talks to the `vault_records` and `sync_state` tables in Supabase.
 * Every record is encrypted client-side before upload (see crypto.ts);
 * the server only ever stores ciphertext + iv + timestamps.
 *
 * Sync model:
 *   • Each record has `id`, `kind`, `updated_at` (client ms), `deleted_at`.
 *   • Upload: push local records whose `updated_at` > lastSyncedAt.
 *   • Download: pull server records whose `updated_at` > lastSyncedAt.
 *   • Conflict: highest `updated_at` wins; tie → server wins (deterministic).
 *   • Tombstones: soft deletes kept for 30 days so offline devices reconcile.
 *
 * When Supabase is not configured, every function returns a disabled
 * result so the app keeps working as local-only.
 */
import { getSupabase, getSupabaseUserId, supabaseConfigured } from "@/lib/supabase";
import {
  decryptRecord,
  encryptRecord,
  generateSalt,
  getSessionKey,
  hasSessionKey,
} from "@/lib/crypto";

export type RecordKind =
  | "document"
  | "expense"
  | "subscription"
  | "appointment"
  | "notification"
  | "settings"
  | "security"
  | "folder";

/** A logical record as it lives in local state. */
export interface VaultRecord {
  id: string;
  kind: RecordKind;
  /** Full record payload (document/expense/etc.) as JSON. */
  data: unknown;
  /** Client ms timestamp of last mutation. */
  updatedAt: number;
  /** Client ms timestamp of deletion, or null if alive. */
  deletedAt: number | null;
}

/** Row in the Supabase `vault_records` table. */
interface VaultRecordRow {
  id: string;
  kind: RecordKind;
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
}

const TABLE_RECORDS = "vault_records";
const TABLE_STATE = "sync_state";
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type SyncOutcome =
  | { ok: true; disabled: false; uploaded: number; downloaded: number; conflicts: number }
  | { ok: true; disabled: true }
  | { ok: false; error: string };

export interface SyncMetadata {
  lastSyncedAt: number | null;
  lastBackupAt: number | null;
  /** Total records currently stored in the cloud for this user. */
  cloudRecordCount: number;
}

/** True when cloud sync is available AND an encryption key is unlocked. */
export function syncReady(): boolean {
  return supabaseConfigured && hasSessionKey();
}

/** Read sync metadata for the current user. */
export async function getSyncMetadata(): Promise<SyncMetadata | null> {
  if (!supabaseConfigured) return null;
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  if (!sb || !userId) return null;

  try {
    const { data: state } = await sb
      .from(TABLE_STATE)
      .select("last_synced_at, last_backup_at, schema_version")
      .eq("user_id", userId)
      .maybeSingle();

    const { count } = await sb
      .from(TABLE_RECORDS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("id", SALT_ID)
      .is("deleted_at", null);

    return {
      lastSyncedAt: (state as SyncStateRow | null)?.last_synced_at ?? null,
      lastBackupAt: (state as SyncStateRow | null)?.last_backup_at ?? null,
      cloudRecordCount: count ?? 0,
    };
  } catch (err) {
    console.warn("[CloudBackup] getSyncMetadata failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Upload / backup                                                     */
/* ------------------------------------------------------------------ */

/**
 * Upload every local record to the cloud. Used by "Back up now".
 * Writes all records (upsert), then updates sync_state.last_backup_at.
 * Returns counts. Requires an unlocked session key.
 */
export async function backupAll(
  records: VaultRecord[],
  onProgress?: (done: number, total: number) => void,
): Promise<SyncOutcome> {
  if (!supabaseConfigured) return { ok: true, disabled: true };
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  const key = getSessionKey();
  if (!sb || !userId || !key) {
    return { ok: false, error: "Cloud backup is not unlocked. Enter your backup password first." };
  }

  const total = records.length;
  let done = 0;
  try {
    for (const rec of records) {
      const { ciphertext, iv } = await encryptRecord(key, rec.data);
      const row = {
        id: rec.id,
        user_id: userId,
        kind: rec.kind,
        ciphertext,
        iv,
        updated_at: rec.updatedAt,
        deleted_at: rec.deletedAt,
      };
      // Upsert keyed on (user_id, id).
      const { error } = await sb
        .from(TABLE_RECORDS)
        .upsert(row, { onConflict: "user_id,id" });
      if (error) throw new Error(error.message);
      done++;
      onProgress?.(done, total);
    }

    const now = Date.now();
    await sb
      .from(TABLE_STATE)
      .upsert(
        { user_id: userId, last_backup_at: now, last_synced_at: now },
        { onConflict: "user_id" },
      );

    return { ok: true, disabled: false, uploaded: total, downloaded: 0, conflicts: 0 };
  } catch (err) {
    console.error(
      `[CloudBackup] backupAll failed after ${done}/${total} records:`,
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backup failed.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Download / restore                                                  */
/* ------------------------------------------------------------------ */

export interface RestoreResult {
  ok: boolean;
  disabled: boolean;
  records: VaultRecord[];
  error?: string;
}

/**
 * Download every record for the current user from the cloud. Used by
 * "Restore from cloud" on a new device. Requires an unlocked session key.
 */
export async function restoreAll(
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreResult> {
  if (!supabaseConfigured) return { ok: true, disabled: true, records: [] };
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  const key = getSessionKey();
  if (!sb || !userId || !key) {
    return {
      ok: false,
      disabled: false,
      records: [],
      error: "Cloud restore is not unlocked. Enter your backup password first.",
    };
  }

  try {
    const { data, error } = await sb
      .from(TABLE_RECORDS)
      .select("id, kind, ciphertext, iv, updated_at, deleted_at")
      .eq("user_id", userId)
      .neq("id", SALT_ID)
      .order("updated_at", { ascending: true });

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as VaultRecordRow[];

    const records: VaultRecord[] = [];
    let done = 0;
    let attempted = 0;
    let decryptFailures = 0;
    for (const row of rows) {
      // Skip stale tombstones older than the TTL.
      if (row.deleted_at && Date.now() - row.deleted_at > TOMBSTONE_TTL_MS) {
        done++;
        onProgress?.(done, rows.length);
        continue;
      }
      attempted++;
      try {
        const payload = await decryptRecord<unknown>(key, {
          ciphertext: row.ciphertext,
          iv: row.iv,
        });
        records.push({
          id: row.id,
          kind: row.kind,
          data: payload,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
        });
      } catch {
        // A single undecryptable row (e.g. from an old password) should
        // not abort the whole restore. Skip it; the user can re-back-up.
        decryptFailures++;
      }
      done++;
      onProgress?.(done, rows.length);
    }

    // Every row failed to decrypt → the derived key is wrong for this data.
    if (attempted > 0 && records.length === 0 && decryptFailures === attempted) {
      return {
        ok: false,
        disabled: false,
        records: [],
        error:
          "Couldn't decrypt your backup with this password. It was encrypted with a different backup password.",
      };
    }

    // Update sync_state so future syncs are incremental from this point.
    await sb
      .from(TABLE_STATE)
      .upsert(
        { user_id: userId, last_synced_at: Date.now() },
        { onConflict: "user_id" },
      );

    if (decryptFailures > 0) {
      console.warn(`[CloudBackup] restoreAll: ${decryptFailures}/${attempted} rows could not be decrypted`);
    }
    return { ok: true, disabled: false, records };
  } catch (err) {
    console.error("[CloudBackup] restoreAll failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      disabled: false,
      records: [],
      error: err instanceof Error ? err.message : "Restore failed.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Incremental sync                                                    */
/* ------------------------------------------------------------------ */

export interface IncrementalSyncResult {
  ok: boolean;
  disabled: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  /** Records from the server that are newer than local — to be merged. */
  remoteNewer: VaultRecord[];
  error?: string;
}

/**
 * Incremental sync: push local changes and pull remote changes since
 * the last sync. Conflict rule: highest updatedAt wins; tie → remote.
 *
 * `localRecords` is the full current local set (we filter by
 * updatedAt > lastSyncedAt). Returns remote records that are newer
 * than their local counterparts (or not present locally) so the caller
 * can merge them into state.
 */
export async function syncIncremental(
  localRecords: VaultRecord[],
): Promise<IncrementalSyncResult> {
  if (!supabaseConfigured) {
    return { ok: true, disabled: true, uploaded: 0, downloaded: 0, conflicts: 0, remoteNewer: [] };
  }
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  const key = getSessionKey();
  if (!sb || !userId || !key) {
    return {
      ok: false,
      disabled: false,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      remoteNewer: [],
      error: "Cloud sync is not unlocked.",
    };
  }

  try {
    // 1. Read last sync pointer.
    const { data: stateRow } = await sb
      .from(TABLE_STATE)
      .select("last_synced_at")
      .eq("user_id", userId)
      .maybeSingle();
    const lastSyncedAt = (stateRow as SyncStateRow | null)?.last_synced_at ?? 0;

    // 2. Pull all remote rows newer than lastSyncedAt (excluding the salt row).
    const { data: remoteRows, error: pullErr } = await sb
      .from(TABLE_RECORDS)
      .select("id, kind, ciphertext, iv, updated_at, deleted_at")
      .eq("user_id", userId)
      .neq("id", SALT_ID)
      .gt("updated_at", lastSyncedAt);
    if (pullErr) throw new Error(pullErr.message);
    const remote = (remoteRows ?? []) as VaultRecordRow[];

    // 3. Decrypt remote rows and compute remote-newer set.
    const localById = new Map(localRecords.map((r) => [r.id, r]));
    const remoteNewer: VaultRecord[] = [];
    let conflicts = 0;

    for (const row of remote) {
      let payload: unknown;
      try {
        payload = await decryptRecord<unknown>(key, {
          ciphertext: row.ciphertext,
          iv: row.iv,
        });
      } catch {
        continue;
      }
      const local = localById.get(row.id);
      if (!local || row.updated_at > local.updatedAt) {
        remoteNewer.push({
          id: row.id,
          kind: row.kind,
          data: payload,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
        });
      } else if (row.updated_at === local.updatedAt) {
        // Tie → remote wins (deterministic).
        conflicts++;
        remoteNewer.push({
          id: row.id,
          kind: row.kind,
          data: payload,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
        });
      }
    }

    // 4. Push local records newer than lastSyncedAt.
    let uploaded = 0;
    for (const rec of localRecords) {
      if (rec.updatedAt <= lastSyncedAt) continue;
      const { ciphertext, iv } = await encryptRecord(key, rec.data);
      const { error: upErr } = await sb
        .from(TABLE_RECORDS)
        .upsert(
          {
            id: rec.id,
            user_id: userId,
            kind: rec.kind,
            ciphertext,
            iv,
            updated_at: rec.updatedAt,
            deleted_at: rec.deletedAt,
          },
          { onConflict: "user_id,id" },
        );
      if (upErr) throw new Error(upErr.message);
      uploaded++;
    }

    // 5. Advance the sync pointer.
    const now = Date.now();
    await sb
      .from(TABLE_STATE)
      .upsert(
        { user_id: userId, last_synced_at: now },
        { onConflict: "user_id" },
      );

    return {
      ok: true,
      disabled: false,
      uploaded,
      downloaded: remoteNewer.length,
      conflicts,
      remoteNewer,
    };
  } catch (err) {
    console.error("[CloudBackup] syncIncremental failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      disabled: false,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      remoteNewer: [],
      error: err instanceof Error ? err.message : "Sync failed.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Wipe                                                                */
/* ------------------------------------------------------------------ */

/** Delete every cloud record + sync state for the current user. */
export async function wipeCloudData(): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: true };
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  if (!sb || !userId) return { ok: false, error: "Not signed in to cloud." };
  try {
    await sb.from(TABLE_RECORDS).delete().eq("user_id", userId);
    await sb.from(TABLE_STATE).delete().eq("user_id", userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Wipe failed." };
  }
}

/* ------------------------------------------------------------------ */
/* Salt storage                                                        */
/* ------------------------------------------------------------------ */

/**
 * The encryption salt is stored in sync_state (as part of the schema_version
 * field's metadata). We keep it simple: a dedicated row in vault_records
 * with kind='__salt__' that's never encrypted. This lets a new device
 * fetch the salt before deriving the key.
 */
const SALT_ID = "__salt__";

/** Store the salt for this user (called during initial backup setup). */
export async function storeSalt(salt: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: "Cloud backup is not configured." };
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  if (!sb || !userId) return { ok: false, error: "Not signed in to cloud." };
  try {
    const { error } = await sb
      .from(TABLE_STATE)
      .upsert(
        {
          user_id: userId,
          last_synced_at: null,
          last_backup_at: null,
          schema_version: 1,
        },
        { onConflict: "user_id" },
      );
    if (error) {
      console.error("[CloudBackup] storeSalt (sync_state) failed:", error.message);
      return { ok: false, error: error.message };
    }
    // Store salt in its own row so it's fetchable before key derivation.
    const { error: saltErr } = await sb
      .from(TABLE_RECORDS)
      .upsert(
        {
          id: SALT_ID,
          user_id: userId,
          kind: "settings", // reuse existing kind — payload is the salt string
          ciphertext: salt, // NOT encrypted — this is the salt itself
          iv: "",
          updated_at: Date.now(),
          deleted_at: null,
        },
        { onConflict: "user_id,id" },
      );
    if (saltErr) {
      console.error("[CloudBackup] storeSalt (vault_records) failed:", saltErr.message);
      return { ok: false, error: saltErr.message };
    }
    return { ok: true };
  } catch (err) {
    console.error("[CloudBackup] storeSalt threw:", err instanceof Error ? err.message : err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not store encryption salt." };
  }
}

export interface SaltFetchResult {
  /** False when the request itself failed (network / missing tables). */
  ok: boolean;
  /** The stored salt, or null when the user has never set up cloud backup. */
  salt: string | null;
  error?: string;
}

/**
 * Retrieve the stored salt for this user (called on a new device).
 * Distinguishes "no salt stored" (ok: true, salt: null) from request
 * failures (ok: false) so callers never rotate an existing salt just
 * because the network hiccuped.
 */
export async function fetchSalt(): Promise<SaltFetchResult> {
  if (!supabaseConfigured) return { ok: false, salt: null, error: "Cloud backup is not configured." };
  const sb = getSupabase();
  const userId = await getSupabaseUserId();
  if (!sb || !userId) return { ok: false, salt: null, error: "Not signed in to cloud." };
  try {
    const { data, error } = await sb
      .from(TABLE_RECORDS)
      .select("ciphertext")
      .eq("user_id", userId)
      .eq("id", SALT_ID)
      .maybeSingle();
    if (error) {
      console.error("[CloudBackup] fetchSalt query failed:", error.message);
      return { ok: false, salt: null, error: error.message };
    }
    const row = data as { ciphertext?: string } | null;
    return { ok: true, salt: row?.ciphertext ?? null };
  } catch (err) {
    console.error("[CloudBackup] fetchSalt threw:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      salt: null,
      error: err instanceof Error ? err.message : "Could not fetch encryption salt.",
    };
  }
}

/** True if the user already has a salt (i.e. has set up cloud backup before). */
export async function hasCloudBackup(): Promise<boolean> {
  const res = await fetchSalt();
  return res.ok && res.salt !== null;
}

/** Generate a fresh salt and store it. Used during first-time setup. */
export async function initCloudSalt(): Promise<{ salt: string | null; error?: string }> {
  const salt = generateSalt();
  const res = await storeSalt(salt);
  return res.ok ? { salt } : { salt: null, error: res.error };
}
