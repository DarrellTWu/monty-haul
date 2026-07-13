// Runs every offline test suite (no Supabase credentials required).
// Usage: npm run test:all
// The Supabase smoke tests (server/tests/*-smoke.js) stay manual — they need
// live credentials and a throwaway player. See docs/deployment-guide.md §5.
import { spawnSync } from 'node:child_process';

const SUITES = [
  'shared/tests/combat.test.js',
  'shared/tests/loot.test.js',
  'shared/tests/geometry.test.js',
  'shared/tests/character.test.js',
  'shared/tests/equipment.test.js',
  'shared/tests/conditions.test.js',
  'shared/tests/class-progression.test.js',
  'shared/tests/items.test.js',
  'shared/tests/floors.test.js',
  'server/tests/container-lock.test.js',
  'server/tests/loot-flow.test.js',
  'server/tests/target-selection.test.js',
  'server/tests/ranged-combat.test.js',
  'server/tests/level-up-flow.test.js',
  'server/tests/with-retry.test.js',
  'server/tests/dead-letter.test.js',
];

const failures = [];
for (const suite of SUITES) {
  console.log(`\n══ ${suite} ══`);
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status !== 0) failures.push(suite);
}

console.log('\n──────────────────────────────────────────────────');
if (failures.length === 0) {
  console.log(`All ${SUITES.length} suites passed.`);
} else {
  console.error(`${failures.length}/${SUITES.length} suites FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
