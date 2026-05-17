// shared/data/weapons/ranged.js
// Ranged weapon definitions. Each entry matches the Weapon typedef with
// `kind: 'ranged'` and a required `range: { normal, long }` block in px.
// Damage/attack ability use the same fields as melee.

import { ft } from '../constants.js';

/** @type {import('../../types/weapon.js').Weapon} */
export const SHORTBOW = {
  id: 'shortbow',
  kind: 'ranged',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['two-handed'],
  range: { normal: ft(80), long: ft(320) },
};

/** @type {import('../../types/weapon.js').Weapon} */
export const LONGBOW = {
  id: 'longbow',
  kind: 'ranged',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['two-handed', 'heavy'],
  range: { normal: ft(150), long: ft(600) },
};
