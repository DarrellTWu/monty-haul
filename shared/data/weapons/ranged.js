// shared/data/weapons/ranged.js
// Ranged weapon definitions. Each entry matches the Weapon typedef with
// `category: 'weapon'`, `type: 'ranged'`, and a required `range: { normal, long }`
// block in px. Damage/attack ability use the same fields as melee.

import { ft } from '../constants.js';

/** @type {import('../../types/weapon.js').Weapon} */
export const SHORTBOW = {
  id: 'shortbow',
  category: 'weapon',
  type: 'ranged',
  label: 'Shortbow',
  damageDice: { count: 1, sides: 6 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['two-handed'],
  range: { normal: ft(80), long: ft(320) },
  goldValue: 25,
  sortKey: 170,
  note: 'ranged 80/320, two-handed',
};

/** @type {import('../../types/weapon.js').Weapon} */
export const LONGBOW = {
  id: 'longbow',
  category: 'weapon',
  type: 'ranged',
  label: 'Longbow',
  damageDice: { count: 1, sides: 8 },
  damageBonus: 0,
  damageType: 'piercing',
  enhancement: 0,
  attackAbility: 'dex',
  properties: ['two-handed', 'heavy'],
  range: { normal: ft(150), long: ft(600) },
  goldValue: 50,
  sortKey: 180,
  note: 'ranged 150/600, two-handed',
};
