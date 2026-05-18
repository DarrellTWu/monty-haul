// shared/data/values.js
// Canonical gold value for every item in the game. SRD prices for
// weapons/armor/potions; nominal values for crafting materials.
// Single source of truth — both the shop's buy prices and the stash
// sell prices derive from this map.

export const ITEM_GOLD_VALUE = {
  // Weapons (SRD PHB equipment table)
  dagger:          2,
  handaxe:         5,
  mace:            5,
  shortsword:      10,
  longsword:       15,
  greataxe:        30,
  greatsword:      50,
  shortbow:        25,
  longbow:         50,

  // Armor (SRD PHB equipment table)
  padded:          5,
  leather:         10,
  hide:            10,
  ring_mail:       30,
  studded_leather: 45,
  chain_shirt:     50,
  scale_mail:      50,
  chain_mail:      75,
  splint:          200,
  breastplate:     400,
  half_plate:      750,
  plate:           1500,
  shield:          10,

  // Potions — match shop catalog pricing.
  healing_potion:     50,
  longstrider_potion: 75,
  false_life_potion:  100,
  bless_potion:       250,
  extraction_scroll:  100,

  // Crafting materials — nominal sell value so nothing is permanently
  // unsellable; crafting use should still dominate.
  wolf_pelt:     4,
  skeleton_bone: 2,
};

export const SELL_RATIO = 0.25;

/**
 * Sale price for `id` at the hub vendor. Returns 0 if the item has no
 * defined value. Floor of (value × ratio), but never less than 1 gp for
 * items that have a value — at quarter price, 2 gp items would otherwise
 * round to 0 and be unsellable.
 */
export function sellPrice(id) {
  const v = ITEM_GOLD_VALUE[id];
  if (!v) return 0;
  return Math.max(1, Math.floor(v * SELL_RATIO));
}
