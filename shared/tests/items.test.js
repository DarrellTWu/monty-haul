// shared/tests/items.test.js
// ─────────────────────────────────────────────────────────────────
// Itemization validator. Pure data + display checks for ITEM_REGISTRY,
// every type-specific registry, and every external reference to an item id
// from floors, loot tables, vendors, and crafting recipes.
//
// Run with: node shared/tests/items.test.js
//
// No test framework — assert + a pass/fail counter that exits non-zero on
// any failure so it can wire into CI without ceremony.

import assert from 'node:assert/strict';

import { ITEM_REGISTRY, CATEGORY_DISPLAY_ORDER, isKnownItem } from '../data/items/index.js';
import { WEAPON_REGISTRY }     from '../data/weapons/index.js';
import { ARMOR_REGISTRY }      from '../data/armor/armor.js';
import { SHIELD_REGISTRY }     from '../data/items/shields.js';
import { CONSUMABLE_REGISTRY } from '../data/items/consumables.js';
import { MATERIAL_REGISTRY }   from '../data/items/materials.js';
import { getItemDisplay }      from '../logic/item-display.js';
import { FLOOR_REGISTRY }      from '../data/floors/index.js';
import { LOOT_TABLE_REGISTRY } from '../data/loot/tier1.js';
import { VENDOR_CATALOG }      from '../data/shop.js';
import { RECIPE_REGISTRY }     from '../data/crafting/recipes.js';
import { BENCH_REGISTRY }      from '../data/crafting/benches.js';

// ─── Pass/fail harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failures.push({ name, err });
    failed++;
  }
}

function describe(suite, fn) {
  console.log(`\n${suite}`);
  fn();
}

// ─── 1. Every item has required base fields ──────────────────────────────────

describe('base item shape', () => {
  for (const [id, def] of Object.entries(ITEM_REGISTRY)) {
    test(`${id} has id/category/label/goldValue/sortKey`, () => {
      assert.equal(def.id, id, 'def.id must match registry key');
      assert.ok(typeof def.category === 'string' && def.category.length > 0, 'category required');
      assert.ok(CATEGORY_DISPLAY_ORDER.includes(def.category), `category must be one of ${CATEGORY_DISPLAY_ORDER.join('|')}`);
      assert.ok(typeof def.label === 'string' && def.label.length > 0, 'label must be non-empty string');
      assert.ok(typeof def.goldValue === 'number' && def.goldValue >= 0, 'goldValue must be number ≥ 0');
      assert.ok(typeof def.sortKey === 'number' && Number.isFinite(def.sortKey), 'sortKey must be finite number');
    });
  }
});

// ─── 2. Per-category required fields ─────────────────────────────────────────

describe('per-category required fields', () => {
  for (const [id, def] of Object.entries(WEAPON_REGISTRY)) {
    test(`weapon ${id} has type/damageDice/damageType/attackAbility`, () => {
      assert.equal(def.category, 'weapon');
      assert.ok(def.type === 'melee' || def.type === 'ranged', `type must be melee|ranged (got ${def.type})`);
      assert.ok(def.damageDice && typeof def.damageDice.count === 'number' && typeof def.damageDice.sides === 'number', 'damageDice required');
      assert.ok(typeof def.damageType === 'string' && def.damageType.length > 0, 'damageType required');
      assert.ok(def.attackAbility === 'str' || def.attackAbility === 'dex', 'attackAbility must be str|dex');
      if (def.type === 'ranged') {
        assert.ok(def.range && typeof def.range.normal === 'number' && typeof def.range.long === 'number',
          'ranged weapons require range.normal and range.long');
      }
    });
  }
  for (const [id, def] of Object.entries(ARMOR_REGISTRY)) {
    test(`armor ${id} has type/baseAC`, () => {
      assert.equal(def.category, 'armor');
      assert.ok(['light', 'medium', 'heavy'].includes(def.type), `armor type must be light|medium|heavy (got ${def.type})`);
      assert.ok(typeof def.baseAC === 'number' && def.baseAC >= 10, 'baseAC must be number ≥ 10');
    });
  }
  for (const [id, def] of Object.entries(SHIELD_REGISTRY)) {
    test(`shield ${id} has acBonus`, () => {
      assert.equal(def.category, 'shield');
      assert.ok(typeof def.acBonus === 'number' && def.acBonus > 0, 'acBonus must be positive number');
    });
  }
  for (const [id, def] of Object.entries(CONSUMABLE_REGISTRY)) {
    test(`consumable ${id} has type`, () => {
      assert.equal(def.category, 'consumable');
      assert.ok(typeof def.type === 'string' && def.type.length > 0, 'consumable type required');
    });
  }
  for (const [id, def] of Object.entries(MATERIAL_REGISTRY)) {
    test(`material ${id} base shape`, () => {
      assert.equal(def.category, 'material');
    });
  }
});

// ─── 3. id matches map key in every type-specific registry ───────────────────

describe('id matches registry key', () => {
  const registries = [
    ['WEAPON_REGISTRY',     WEAPON_REGISTRY],
    ['ARMOR_REGISTRY',      ARMOR_REGISTRY],
    ['SHIELD_REGISTRY',     SHIELD_REGISTRY],
    ['CONSUMABLE_REGISTRY', CONSUMABLE_REGISTRY],
    ['MATERIAL_REGISTRY',   MATERIAL_REGISTRY],
  ];
  for (const [name, reg] of registries) {
    test(`${name}: every entry's def.id matches its key`, () => {
      for (const [key, def] of Object.entries(reg)) {
        assert.equal(def.id, key, `${name}.${key}: def.id is "${def.id}"`);
      }
    });
  }
});

// ─── 4. Disjoint id namespaces across type-specific registries ───────────────

describe('disjoint id namespaces', () => {
  test('no id appears in more than one type-specific registry', () => {
    const registries = {
      WEAPON_REGISTRY,
      ARMOR_REGISTRY,
      SHIELD_REGISTRY,
      CONSUMABLE_REGISTRY,
      MATERIAL_REGISTRY,
    };
    const owners = new Map(); // id → first owning registry name
    for (const [name, reg] of Object.entries(registries)) {
      for (const id of Object.keys(reg)) {
        const prev = owners.get(id);
        if (prev) {
          throw new Error(`id "${id}" appears in both ${prev} and ${name}`);
        }
        owners.set(id, name);
      }
    }
  });
});

// ─── 5. getItemDisplay returns a complete shape for every item ───────────────

describe('getItemDisplay completeness', () => {
  for (const id of Object.keys(ITEM_REGISTRY)) {
    test(`getItemDisplay('${id}') returns complete shape`, () => {
      const d = getItemDisplay(id);
      assert.ok(d, 'must not be null');
      assert.equal(d.id, id);
      assert.ok(typeof d.label === 'string' && d.label.length > 0, 'label populated');
      assert.ok(typeof d.detail === 'string' && d.detail.length > 0, 'detail populated');
      assert.ok(typeof d.section === 'string' && d.section.length > 0, 'section populated');
      assert.ok(typeof d.sortKey === 'number', 'sortKey populated');
      assert.ok(typeof d.category === 'string', 'category populated');
      // note is optional — must be null or a non-empty string
      assert.ok(d.note === null || (typeof d.note === 'string' && d.note.length > 0), 'note is null or non-empty');
    });
  }
});

// ─── 6. Reference integrity from floors/loot/vendor data ─────────────────────

describe('reference integrity', () => {
  test('every chest item across FLOOR_REGISTRY resolves in ITEM_REGISTRY', () => {
    for (const [floorNum, floor] of Object.entries(FLOOR_REGISTRY)) {
      for (const chest of floor.chests ?? []) {
        for (const itemId of chest.items ?? []) {
          assert.ok(isKnownItem(itemId), `floor ${floorNum} chest "${chest.id}" references unknown item "${itemId}"`);
        }
      }
    }
  });

  test('every literal loot-table itemId resolves in ITEM_REGISTRY (pool refs skipped)', () => {
    for (const [enemyType, table] of Object.entries(LOOT_TABLE_REGISTRY)) {
      for (const drop of table.drops ?? []) {
        if (typeof drop.itemId === 'string' && drop.itemId.startsWith('@')) continue;
        assert.ok(isKnownItem(drop.itemId), `loot table for "${enemyType}" references unknown item "${drop.itemId}"`);
      }
    }
  });

  test('every vendor catalog id resolves in ITEM_REGISTRY', () => {
    for (const [vendor, entries] of Object.entries(VENDOR_CATALOG)) {
      for (const entry of entries) {
        assert.ok(isKnownItem(entry.id), `vendor "${vendor}" references unknown item "${entry.id}"`);
      }
    }
  });
});

// ─── 7. Recipe reference + output category integrity ─────────────────────────

describe('recipe reference integrity', () => {
  test('every recipe input id resolves in ITEM_REGISTRY', () => {
    for (const [recipeId, recipe] of Object.entries(RECIPE_REGISTRY)) {
      for (const input of recipe.inputs) {
        assert.ok(isKnownItem(input.id), `recipe "${recipeId}" input references unknown item "${input.id}"`);
        assert.ok(typeof input.qty === 'number' && input.qty > 0, `recipe "${recipeId}" input qty must be positive`);
      }
    }
  });

  test('every recipe output id resolves in ITEM_REGISTRY with a known category', () => {
    // Whitelist is all five known categories — really an isKnownItem check plus
    // a defense against a future sixth category being added without updating
    // the crafting UI. If you add a category, expand this set deliberately.
    const ALLOWED_OUTPUT_CATEGORIES = new Set(['weapon', 'armor', 'shield', 'consumable', 'material']);
    for (const [recipeId, recipe] of Object.entries(RECIPE_REGISTRY)) {
      const outId = recipe.output.id;
      assert.ok(isKnownItem(outId), `recipe "${recipeId}" output references unknown item "${outId}"`);
      const outDef = ITEM_REGISTRY[outId];
      assert.ok(ALLOWED_OUTPUT_CATEGORIES.has(outDef.category),
        `recipe "${recipeId}" output "${outId}" has category "${outDef.category}" not in whitelist`);
      assert.ok(typeof recipe.output.qty === 'number' && recipe.output.qty > 0,
        `recipe "${recipeId}" output qty must be positive`);
    }
  });
});

// ─── 8. Recipe bench reference ───────────────────────────────────────────────

describe('recipe bench reference', () => {
  test('every recipe.bench resolves in BENCH_REGISTRY', () => {
    for (const [recipeId, recipe] of Object.entries(RECIPE_REGISTRY)) {
      assert.ok(Object.hasOwn(BENCH_REGISTRY, recipe.bench),
        `recipe "${recipeId}" references unknown bench "${recipe.bench}"`);
    }
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`);
if (failed > 0) {
  process.exit(1);
}
