// shared/data/crafting/recipes.js
// Recipe registry. A recipe is { id, label, bench, inputs, output } where
// `inputs` is an array of { id, qty } and `output` is { id, qty }.
//
// All ratios in this file are placeholders pending a balance/playtest pass.
// Phase 1 seeds two recipes — one Apothecary, one Forge — to prove the loop
// across both consumable and equipment outputs. Other benches stay empty.

export const TAN_HIDE = {
  id:     'tan_hide',
  label:  'Tan Hide',
  bench:  'forge',
  inputs: [{ id: 'wolf_pelt', qty: 2 }],
  output: { id: 'hide',       qty: 1 },
};

export const BONE_BREW = {
  id:     'bone_brew',
  label:  'Bone Brew',
  bench:  'apothecary',
  inputs: [{ id: 'skeleton_bone',    qty: 2 }],
  output: { id: 'false_life_potion', qty: 1 },
};

export const RECIPE_REGISTRY = {
  tan_hide:  TAN_HIDE,
  bone_brew: BONE_BREW,
};

/** All recipes whose `bench` matches `benchId`. Pure, allocation-light. */
export function recipesForBench(benchId) {
  return Object.values(RECIPE_REGISTRY).filter(r => r.bench === benchId);
}
