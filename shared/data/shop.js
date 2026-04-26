// shared/data/shop.js
// Hub vendor catalog. Two vendors, infinite stock. Buy prices are SRD-standard,
// sourced from shared/data/values.js so buy/sell stay in sync automatically.
// Order within each list is ascending price — display layer relies on it.

import { ITEM_GOLD_VALUE } from './values.js';

const POTION_IDS = [
  'healing_potion',
  'longstrider_potion',
  'false_life_potion',
  'bless_potion',
];

const ARMOR_IDS = [
  'padded',
  'leather',
  'hide',
  'ring_mail',
  'studded_leather',
  'chain_shirt',
  'scale_mail',
  'chain_mail',
  'splint',
  'breastplate',
  'half_plate',
  'plate',
];

const withPrice = (ids) => ids.map(id => ({ id, price: ITEM_GOLD_VALUE[id] }));

export const VENDOR_CATALOG = {
  potions: withPrice(POTION_IDS),
  armor:   withPrice(ARMOR_IDS),
};
