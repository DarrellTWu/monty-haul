// Write-side op for run history.
//
// One row per completed or abandoned run, inserted on extract / death.
// Schema: see supabase/migrations/001_initial_schema.sql (run_history).
//
// Caller is responsible for try/catching this — a failed insert is telemetry
// loss, not player-state loss, and should not bubble up far enough to
// invalidate the stash mutation that preceded it.
import { supabase } from './supabase.js';

export async function insertRunHistory({
  playerId, classId, floorsReached, extracted,
  goldExtracted, itemsExtracted, kills, runDurationS,
}) {
  const { error } = await supabase.from('run_history').insert({
    player_id:       playerId,
    class:           classId,
    floors_reached:  floorsReached,
    extracted,
    gold_extracted:  goldExtracted,
    items_extracted: itemsExtracted,
    kills,
    run_duration_s:  runDurationS,
  });
  if (error) throw error;
}
