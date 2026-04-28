# Character Creation — Ability Score Assignment
*Feature Plan | Point Buy System*

## Overview

Add a point buy ability score assignment step to the hub's Class tab, between class selection and entering the dungeon. Players distribute 27 points across six ability scores (STR, DEX, CON, INT, WIS, CHA) before each run. Each class pre-fills a recommended allocation; players may adjust freely within the rules.

This feature also uses the opportunity to:
- Store ability scores on `PlayerState` (necessary for SRD-faithful runtime mutations — potions, racial bonuses, ASIs)
- Establish `_recomputeStats(player)` as the canonical hook for all derived-stat recomputation
- Replace hardcoded Fighter placeholder stats in `InventoryScene` with live player state

---

## The Point Buy Rules

**Budget:** 27 points  
**Range:** 8–16 at character creation (18+ reachable through play; 16 cap leaves room for future racial modifiers)  
**Cost table:**

| Score | Cost | Score | Cost |
|-------|------|-------|------|
| 8  | 0  | 13 | 5  |
| 9  | 1  | 14 | 7  |
| 10 | 2  | 15 | 9  |
| 11 | 3  | 16 | 12 |
| 12 | 4  |    |    |

The standard array [15, 14, 13, 12, 10, 8] costs exactly 27 points and is the default allocation for each class, assigned class-appropriately.

**Class defaults (all 27 pts):**

| Class | STR | DEX | CON | INT | WIS | CHA |
|-------|-----|-----|-----|-----|-----|-----|
| Fighter    | 15 | 13 | 14 |  8 | 12 | 10 |
| Barbarian  | 15 | 13 | 14 |  8 | 10 | 12 |
| Monk       | 12 | 15 | 13 |  8 | 14 | 10 |

---

## UI Design

Lives in the Class tab of HubScene, rendered below class traits when a class is selected.

```
ABILITY SCORES                Points: 27 / 27
──────────────────────────────────────────────
STR  [ − ]  15  (+2)  [ + ]
DEX  [ − ]  13  (+1)  [ + ]
CON  [ − ]  14  (+2)  [ + ]
INT  [ − ]   8  (−1)  [ + ]
WIS  [ − ]  12  (+1)  [ + ]
CHA  [ − ]  10  (+0)  [ + ]
──────────────────────────────────────────────
Estimated starting HP: 26
[ Reset to Class Defaults ]
```

**Button rules:**
- `[−]` disabled when score ≤ 8
- `[+]` disabled when score ≥ 16 OR cost of next tier exceeds remaining points
- Points counter updates live on every change
- Switching to a different class resets to that class's defaults

---

## Architecture

### Why ability scores go on PlayerState

Ability scores change during play: Potions of Giant Strength, ability score improvements at level 4/8/12, racial modifiers, conditions like strength drain. They need to be live mutable runtime state — not a static class-file lookup. Once they live on `PlayerState`, every future feature becomes `player.str = newValue` followed by `_recomputeStats(player)`.

### _recomputeStats — the canonical derived-stat hook

`_recomputeStats(player)` in `DungeonRoom` is the single call site for all derived-value recomputation. Today it only computes AC. Future additions slot in without touching call sites.

```
_recomputeStats(player)
  └── AC (from armor + DEX, or unarmored defense)   ← implemented now
  └── attack modifier                                ← add with Extra Attack
  └── initiative                                     ← add with initiative system
  └── spell save DC                                  ← add with Wave 2 casters
```

Called whenever scores or equipment change: equip/unequip, Potion of Giant Strength, racial bonus, level-up ASI.

---

## Files Changed

### `shared/data/constants.js`
Add character creation constants:
```js
export const POINT_BUY_BUDGET = 27;
export const POINT_COST = { 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9, 16:12 };
export const SCORE_MIN = 8;
export const SCORE_MAX = 16;
```

### `server/state/PlayerState.js`
Add six ability score fields to the Colyseus schema:
```js
this.str = 10;
this.dex = 10;
this.con = 10;
this.int = 10;
this.wis = 10;
this.cha = 10;
// + defineTypes entries: 'number' for each
```

### `server/rooms/DungeonRoom.js`
- **`onJoin`**: Accept `options.abilityScores`. Validate: each score in [8, 16], total point cost ≤ 27. On failure, fall back to `classDef.baseAbilityScores`. Assign validated scores to `player.str` / `player.dex` / etc.
- **`_recomputeStats(player)`**: Rename from `_recomputeAC`. Logic unchanged today; name and pattern established for future derived stats.
- **`_checkTraps`**: Build `creature.abilityScores` from player state fields instead of class registry.

### `server/systems/CombatSystem.js`
- **`playerToAttacker(player)`**: Build `abilityScores` from `{ str: player.str, dex: player.dex, ... }` instead of `classDef.baseAbilityScores`. Removes the class registry lookup from this function entirely.

### `client/src/scenes/HubScene.js`
- Import `CLASS_REGISTRY` (for `hitDie` → HP preview calculation)
- Add `defaultScores` to each `CLASS_DISPLAY` entry
- Add `_abilityScores` to scene state; initialized from class defaults on class selection
- Add `_showAbilityScores(x, y)` — renders stat rows with `[−]` / `[+]` buttons and live point counter
- Modify `_selectClass(classId)` to reset `_abilityScores` to class defaults
- Pass `abilityScores: this._abilityScores` in the enter dungeon `scene.start` call

### `client/src/scenes/InventoryScene.js`
- Remove hardcoded `FIGHTER_SCORES`, `SAVE_PROFS`, `PROF_BONUS`
- Import `CLASS_REGISTRY` from shared data; import `getProficiencyBonus` from `shared/logic/combat.js`
- **Ability scores block**: render from `player.str`, `player.dex`, etc.
- **Saving throws block**: proficiency set from `CLASS_REGISTRY[player.class].saveProficiencies`; bonus from `getProficiencyBonus(player.level)`
- **Weapon stat line**: STR/DEX mod from `player.str` / `player.dex`

---

## Files Not Changed

- `shared/data/classes/fighter.js`, `barbarian.js`, `monk.js` — `baseAbilityScores` stays as server fallback; `saveProficiencies` already correct
- `client/src/scenes/DungeonScene.js` — `abilityScores` piggybacks through the existing `init(data)` spread (`this._joinOpts = { ...data, items: ... }`)
- `network/ColyseusClient.js` — `joinDungeon(opts)` already forwards all opts to the server
- `store/stash.js`, `InputHandler.js`, all shared logic — untouched

---

## Server Validation Logic

```js
function validateAbilityScores(scores) {
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  if (!scores || typeof scores !== 'object') return false;
  if (!keys.every(k => typeof scores[k] === 'number')) return false;
  if (!keys.every(k => scores[k] >= SCORE_MIN && scores[k] <= SCORE_MAX)) return false;
  const cost = keys.reduce((sum, k) => sum + (POINT_COST[scores[k]] ?? 999), 0);
  return cost <= POINT_BUY_BUDGET;
}
```

Returns `false` → fall back to `classDef.baseAbilityScores` silently. No error sent to client (the client enforced the rules already; a mismatch means tampering or a bug, not a UX event).

---

## Docs / CLAUDE.md Updates Needed After Build

- **CLAUDE.md file structure**: `PlayerState` gains `str, dex, con, int, wis, cha` fields
- **CLAUDE.md message protocol**: `joinDungeon` opts now include optional `abilityScores: { str, dex, con, int, wis, cha }`
- **tech_spec.md**: PlayerState schema section, `_recomputeStats` pattern, point buy constants

---

*Monty Haul's Dungeon Crawl | Character Creation Plan v1.0*
