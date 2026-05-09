// Write-side ops for player state in Supabase.
//
// Storage model: current-state (see docs/server-persistence-plan.md).
//   - gear_stash: one row per (player_id, item_id). Snapshot-replaced on every sync.
//   - meta_progression: one row per player_id (PK). Upserted on every sync.
//
// Snapshot-replace is wasteful at scale but trivial to reason about and zero-risk
// for the row counts we expect (~10–30 stash items per player). Optimize later if
// needed.
import { supabase } from './supabase.js';

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
// Snapshot-replaces gear_stash rows (delete-all + insert-positive-qty),
// upserts meta_progression by PK.
export async function syncStashAndMeta(player) {
  const { playerId } = player;
  if (!playerId) throw new Error('syncStashAndMeta: missing playerId');

  // ── gear_stash: delete then insert ─────────────────────────────────────────
  const { error: delErr } = await supabase
    .from('gear_stash')
    .delete()
    .eq('player_id', playerId);
  if (delErr) throw delErr;

  const stashRows = (player.stash ?? [])
    .filter(e => e.qty > 0)
    .map(({ id, qty }) => ({
      player_id:    playerId,
      item_id:      id,
      quantity:     qty,
      acquired_via: 'sync',
    }));
  if (stashRows.length > 0) {
    const { error: insErr } = await supabase.from('gear_stash').insert(stashRows);
    if (insErr) throw insErr;
  }

  // ── meta_progression: upsert by PK ─────────────────────────────────────────
  const { error: metaErr } = await supabase
    .from('meta_progression')
    .upsert({
      player_id:   playerId,
      gold:        player.gold ?? 0,
      raider_pack: player.raiderPack ?? [],
      updated_at:  new Date().toISOString(),
    });
  if (metaErr) throw metaErr;
}
