// Write-side ops for player state in Supabase.
//
// Storage model: current-state (see docs/server-persistence-plan.md).
//   - gear_stash: one row per (player_id, item_id). Snapshot-replaced on every sync.
//   - meta_progression: one row per player_id (PK). Upserted on every sync.
//
// Sync model (Phase 3 #5):
//   gear_stash has UNIQUE (player_id, item_id). syncStashAndMeta UPSERTs every
//   row in the player's current stash, then DELETEs rows for this player whose
//   item_id is no longer present. UPSERT-first ordering is deliberate — a
//   crash between UPSERT and DELETE leaves the DB with extra leftover rows
//   (visible to the player) but never with missing items. The reverse ordering
//   could lose items on crash.
//
// Retry policy:
//   - All three ops in syncStashAndMeta (UPSERT stash, DELETE-NOT-IN, UPSERT
//     meta) are idempotent and wrapped in withRetry.
//   - createProfile's three INSERTs are un-retried (one-shot user creation;
//     UNIQUE on username self-protects but mid-sequence retry is gnarly).
//     User retries login on failure.
import { supabase }   from './supabase.js';
import { withRetry }  from './withRetry.js';

// Insert a new player_profiles row + seed gear_stash + create meta_progression.
// Returns the same shape playerLoad uses: { playerId, username, stash, gold, raiderPack }.
//
// Caller is responsible for checking the username doesn't already exist (via
// loadPlayerByUsername). If a race inserts the same username concurrently the
// UNIQUE constraint will reject the second insert with a Postgres 23505 error.
export async function createProfile(username, initialStash = []) {
  const { data: profile, error: e1 } = await supabase
    .from('player_profiles')
    .insert({ username })
    .select('id, username')
    .single();
  if (e1) throw e1;

  const playerId = profile.id;

  if (initialStash.length > 0) {
    const rows = initialStash
      .filter(e => e.qty > 0)
      .map(({ id, qty }) => ({
        player_id:    playerId,
        item_id:      id,
        quantity:     qty,
        acquired_via: 'seed',
      }));
    if (rows.length > 0) {
      const { error: e2 } = await supabase.from('gear_stash').insert(rows);
      if (e2) throw e2;
    }
  }

  const { error: e3 } = await supabase.from('meta_progression').insert({
    player_id:   playerId,
    gold:        0,
    raider_pack: [],
  });
  if (e3) throw e3;

  return {
    playerId,
    username:   profile.username,
    stash:      initialStash.map(e => ({ ...e })),
    gold:       0,
    raiderPack: [],
  };
}

// Persist the player's current stash + gold + raiderPack to Supabase.
// gear_stash: UPSERT current items by (player_id, item_id), then DELETE rows
//   for this player whose item_id is no longer in the stash. UPSERT-first so
//   a crash between ops never deletes items the player still owns.
// meta_progression: UPSERT by PK.
export async function syncStashAndMeta(player) {
  const { playerId } = player;
  if (!playerId) throw new Error('syncStashAndMeta: missing playerId');

  const positiveStash = (player.stash ?? []).filter(e => e.qty > 0);

  // ── gear_stash: UPSERT current items ───────────────────────────────────────
  if (positiveStash.length > 0) {
    const upsertRows = positiveStash.map(({ id, qty }) => ({
      player_id:    playerId,
      item_id:      id,
      quantity:     qty,
      acquired_via: 'sync',
    }));
    await withRetry(async () => {
      // ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity.
      // acquired_via and acquired_at on existing rows stay as their previous
      // values — they preserve a useful "first acquired" history that this
      // sync isn't trying to track.
      const { error } = await supabase
        .from('gear_stash')
        .upsert(upsertRows, { onConflict: 'player_id,item_id' });
      if (error) throw error;
    });
  }

  // ── gear_stash: DELETE rows whose item_id is not in the new stash ─────────
  // Empty-stash branch: blanket DELETE for this player. Otherwise: DELETE
  // where item_id NOT IN (kept ids). Both are idempotent.
  if (positiveStash.length === 0) {
    await withRetry(async () => {
      const { error } = await supabase
        .from('gear_stash')
        .delete()
        .eq('player_id', playerId);
      if (error) throw error;
    });
  } else {
    // PostgREST IN list expects (a,b,c) for unquoted simple values or
    // ("a","b","c") for strings. Item ids are clean snake_case ASCII —
    // double-quoted form is bulletproof.
    const keptIds = positiveStash.map(e => e.id);
    const inList  = '(' + keptIds.map(id => `"${id}"`).join(',') + ')';
    await withRetry(async () => {
      const { error } = await supabase
        .from('gear_stash')
        .delete()
        .eq('player_id', playerId)
        .not('item_id', 'in', inList);
      if (error) throw error;
    });
  }

  // ── meta_progression: UPSERT by PK ─────────────────────────────────────────
  await withRetry(async () => {
    const { error } = await supabase
      .from('meta_progression')
      .upsert({
        player_id:   playerId,
        gold:        player.gold ?? 0,
        raider_pack: player.raiderPack ?? [],
        updated_at:  new Date().toISOString(),
      });
    if (error) throw error;
  });
}

// UPDATE player_profiles.username for a given playerId.
// Race-safe via the existing UNIQUE constraint: a concurrent rename to the
// same name surfaces as Postgres 23505, which we map to a structured failure
// here so the caller doesn't need to know the DB error code.
//
// Wrapped in withRetry — the UPDATE is idempotent. withRetry's default
// predicate skips errors carrying a 5-digit code, so 23505 isn't retried;
// transport-level blips are.
export async function renameUsername(playerId, newUsername) {
  try {
    await withRetry(async () => {
      const { error } = await supabase
        .from('player_profiles')
        .update({ username: newUsername })
        .eq('id', playerId);
      if (error) throw error;
    });
    return { ok: true };
  } catch (err) {
    if (err?.code === '23505') return { ok: false, error: 'username_taken' };
    throw err;
  }
}
