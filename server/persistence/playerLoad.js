// Read-side loaders for player state from Supabase.
// Returns the same shape playerStore uses in-memory:
//   { playerId, username, stash: [{id, qty}], gold, raiderPack: [{id, qty}] }
//
// gear_stash holds one row per acquisition (item_id + quantity + acquired_via).
// We aggregate by item_id on read so the in-memory shape stays flat.
import { supabase } from './supabase.js';

function _aggregateStash(rows) {
  const acc = new Map();
  for (const { item_id, quantity } of rows) {
    acc.set(item_id, (acc.get(item_id) ?? 0) + quantity);
  }
  return [...acc.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty }));
}

async function _loadStateForProfile(profile) {
  const [stashRes, metaRes] = await Promise.all([
    supabase
      .from('gear_stash')
      .select('item_id, quantity')
      .eq('player_id', profile.id),
    supabase
      .from('meta_progression')
      .select('gold, raider_pack')
      .eq('player_id', profile.id)
      .maybeSingle(),
  ]);

  if (stashRes.error) throw stashRes.error;
  if (metaRes.error)  throw metaRes.error;

  const stash      = _aggregateStash(stashRes.data ?? []);
  const gold       = metaRes.data?.gold ?? 0;
  const raiderPack = metaRes.data?.raider_pack ?? [];

  return {
    playerId:   profile.id,
    username:   profile.username,
    stash,
    gold,
    raiderPack,
  };
}

// Lookup by playerId. Returns null if no profile row.
export async function loadPlayer(playerId) {
  const { data: profile, error } = await supabase
    .from('player_profiles')
    .select('id, username')
    .eq('id', playerId)
    .maybeSingle();

  if (error)   throw error;
  if (!profile) return null;
  return _loadStateForProfile(profile);
}

// Lookup by username. Returns null if no profile row (caller decides whether to create one).
export async function loadPlayerByUsername(username) {
  const { data: profile, error } = await supabase
    .from('player_profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle();

  if (error)   throw error;
  if (!profile) return null;
  return _loadStateForProfile(profile);
}
