// server/rooms/DungeonRoom.js
import { createRequire } from 'module';
const { Room } = createRequire(import.meta.url)('colyseus');

import { GameState }  from '../state/GameState.js';
import { PlayerState } from '../state/PlayerState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { ChestState }  from '../state/ChestState.js';
import { TrapState }   from '../state/TrapState.js';
import { StairState }  from '../state/StairState.js';

import { CLASS_REGISTRY, DEFAULT_CLASS } from '../../shared/data/classes/index.js';
import { GOBLIN, DOG, SKELETON }     from '../../shared/data/enemies/tier1.js';
import { FLOOR_REGISTRY }            from '../../shared/data/floors/index.js';
import { getModifier, resolveSave, rollDice } from '../../shared/logic/combat.js';
import { rollLoot }                  from '../../shared/logic/loot.js';
import {
  tryOpenContainer, tryCloseContainer, releaseLocksHeldBy, tickContainerLocks,
  tryTakeItem, tryTakeGold, tryDropItem,
} from '../../shared/logic/loot-window.js';
import { LOOT_TABLE_REGISTRY }       from '../../shared/data/loot/tier1.js';
import { ARMOR_REGISTRY, computeAC } from '../../shared/data/armor/armor.js';
import { LONGSWORD, SHORTSWORD, HANDAXE, GREATAXE, GREATSWORD, DAGGER, MACE } from '../../shared/data/weapons/melee.js';
import { SHIELD_REGISTRY }           from '../../shared/data/items/shields.js';
import { CONSUMABLE_REGISTRY }       from '../../shared/data/items/consumables.js';
import {
  SERVER_TICK_RATE_HZ, MELEE_HIT_RANGE_PX, CHEST_LOOT_RANGE_PX,
  TRAP_DAMAGE, TRAP_SAVE_DC, TRAP_RADIUS_PX, TRAP_COOLDOWN_MS,
  RAGE_DURATION_MS, RAGE_DAMAGE_BONUS,
  POINT_BUY_BUDGET, POINT_COST, SCORE_MIN, SCORE_MAX,
} from '../../shared/data/constants.js';

import * as MovementSystem from '../systems/MovementSystem.js';
import * as AISystem       from '../systems/AISystem.js';
import { playerAttack, enemyAttack, applySecondWind } from '../systems/CombatSystem.js';
import { getPlayer, commitExtract, commitDeath } from '../store/playerStore.js';

const WEAPON_REGISTRY = {
  longsword: LONGSWORD, shortsword: SHORTSWORD,
  handaxe: HANDAXE, greataxe: GREATAXE, greatsword: GREATSWORD, dagger: DAGGER, mace: MACE,
};

// type string → enemy stat block. Used by _loadFloor when reading floor data.
const ENEMY_REGISTRY = { goblin: GOBLIN, dog: DOG, skeleton: SKELETON };

const WALL = 40; // px wall thickness on every floor

export class DungeonRoom extends Room {
  onCreate(options) {
    this.setState(new GameState());
    this._enemyDefs       = new Map();
    this._conditionTimers = new Map(); // `${sessionId}_${condition}` → remainingMs
    this._lootRolled      = new Set(); // enemyIds whose loot has been rolled (one-shot on death)
    this._playerIds       = new Map(); // sessionId → playerId (for store commits)
    this._extracted       = new Set(); // sessionIds who successfully extracted (not deaths)
    this._runStartedAt    = new Map(); // sessionId → ms timestamp at onJoin (for run_history.run_duration_s)
    this._maxFloor        = new Map(); // sessionId → highest floor seen (for run_history.floors_reached)
    this._bounds          = { minX: WALL, maxX: WALL, minY: WALL, maxY: WALL }; // overwritten by _loadFloor

    this._loadFloor(1);

    // ── Movement ──────────────────────────────────────────────────────────────────
    this.onMessage('move', (client, { dx, dy }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) { player.vx = 0; player.vy = 0; }
      else           { player.vx = dx / len; player.vy = dy / len; }
    });

    this.onMessage('stop', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) { player.vx = 0; player.vy = 0; }
    });

    // ── Combat ────────────────────────────────────────────────────────────────────
    this.onMessage('attack', (client) => {
      const result = playerAttack(this.state, client.sessionId, this._enemyDefs);
      for (const msg of result.logs) this.broadcast('combat_log', { message: msg });
    });

    // ── Equip / unequip ───────────────────────────────────────────────────────────
    // 'equip' message: { itemId, slot? }
    //   slot = 'weapon' | 'offhand' | 'armor' | undefined (auto-detect)
    // Server validates: item in inventory, SRD constraints respected.
    this.onMessage('equip', (client, { itemId, slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const id  = String(itemId);
      const idx = player.inventory.indexOf(id);
      if (idx === -1) return; // item must be in bag

      const isShield = !!SHIELD_REGISTRY[id];
      const isWeapon = !!WEAPON_REGISTRY[id];
      const isArmor  = !!ARMOR_REGISTRY[id];

      // Auto-detect target slot if not specified.
      const targetSlot = slot || (isArmor ? 'armor' : isShield ? 'offhand' : 'weapon');

      if (targetSlot === 'armor') {
        if (!isArmor) return;
        // Return old armor to bag first.
        if (player.equippedArmorId) player.inventory.push(player.equippedArmorId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.equippedArmorId = id;
        this._recomputeStats(player);

      } else if (targetSlot === 'offhand') {
        // Offhand accepts one-handed weapons OR shields. Blocks two-handed.
        if (isWeapon && WEAPON_REGISTRY[id]?.properties?.includes('two-handed')) return;
        // Equipping anything to offhand auto-unequips a two-handed weapon from main hand.
        if (player.equippedWeaponId && WEAPON_REGISTRY[player.equippedWeaponId]?.properties?.includes('two-handed')) {
          player.inventory.push(player.equippedWeaponId);
          player.equippedWeaponId = '';
        }
        if (player.offhandId) player.inventory.push(player.offhandId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.offhandId = id;
        this._recomputeStats(player);

      } else { // weapon slot
        if (isShield || isArmor) return;
        const newWeapon = WEAPON_REGISTRY[id];
        if (!newWeapon) return;
        // Two-handed weapon: auto-unequip offhand (player chose to go two-handed).
        if (newWeapon.properties?.includes('two-handed') && player.offhandId) {
          player.inventory.push(player.offhandId);
          player.offhandId = '';
        }
        if (player.equippedWeaponId) player.inventory.push(player.equippedWeaponId);
        player.inventory.splice(player.inventory.indexOf(id), 1);
        player.equippedWeaponId = id;
        this._recomputeStats(player);
      }
    });

    this.onMessage('unequip', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (slot === 'weapon' && player.equippedWeaponId) {
        player.inventory.push(player.equippedWeaponId);
        player.equippedWeaponId = '';
      } else if (slot === 'offhand' && player.offhandId) {
        player.inventory.push(player.offhandId);
        player.offhandId = '';
        this._recomputeStats(player);
      } else if (slot === 'armor' && player.equippedArmorId) {
        player.inventory.push(player.equippedArmorId);
        player.equippedArmorId = '';
        this._recomputeStats(player); // unarmored: AC = 10 + DEX
      }
    });

    // ── Container lock (loot window open/close) ──────────────────────────────────
    // First player to send `open_container` claims the lock; others are denied
    // until the locker closes, walks out of range, dies, descends, or disconnects.
    // The lock is the gate for take_item / take_gold / drop_item below.
    this.onMessage('open_container', (client, { sourceKind, sourceId }) => {
      const result = tryOpenContainer(this.state, client.sessionId, sourceKind, sourceId, CHEST_LOOT_RANGE_PX);
      if (!result.ok) {
        if (result.reason === 'denied') {
          client.send('container_lock_denied', { sourceKind, sourceId, holder: result.holder });
        }
        return;
      }
      console.log(`[DungeonRoom] ${client.sessionId} locked ${sourceKind} ${sourceId}`);
    });

    this.onMessage('close_container', (client, { sourceKind, sourceId }) => {
      if (tryCloseContainer(this.state, client.sessionId, sourceKind, sourceId)) {
        console.log(`[DungeonRoom] ${client.sessionId} released ${sourceKind} ${sourceId}`);
      }
    });

    // ── Item flow into / out of locked containers ─────────────────────────────────
    // All three handlers route through shared/logic/loot-window.js — the gate
    // (alive, source present, corpse dead, in range, lock owned) is one predicate
    // there, not duplicated here.
    this.onMessage('take_item', (client, { sourceKind, sourceId, itemIndex }) => {
      tryTakeItem(this.state, client.sessionId, sourceKind, sourceId, itemIndex, CHEST_LOOT_RANGE_PX);
    });

    this.onMessage('take_gold', (client, { sourceId }) => {
      tryTakeGold(this.state, client.sessionId, sourceId, CHEST_LOOT_RANGE_PX);
    });

    this.onMessage('drop_item', (client, { sourceKind, sourceId, inventoryIndex }) => {
      tryDropItem(this.state, client.sessionId, sourceKind, sourceId, inventoryIndex, CHEST_LOOT_RANGE_PX);
    });

    // ── Descend stairs ────────────────────────────────────────────────────────────
    // Single-room model: when one player descends, the floor swaps for everyone.
    // All players are teleported to the new floor's spawn and given a long rest.
    this.onMessage('descend', (client, { stairId }) => {
      const player = this.state.players.get(client.sessionId);
      const stair  = this.state.stairs.get(String(stairId));
      if (!player || !player.alive || !stair) return;
      if (stair.locked) return;
      const dx = player.x - stair.x;
      const dy = player.y - stair.y;
      if (Math.sqrt(dx * dx + dy * dy) > CHEST_LOOT_RANGE_PX) return;

      const toFloor = stair.toFloor;
      this._loadFloor(toFloor);

      const floor = FLOOR_REGISTRY[toFloor];
      for (const [sid, p] of this.state.players) {
        p.x  = floor.playerSpawn.x;
        p.y  = floor.playerSpawn.y;
        p.vx = 0; p.vy = 0;
        this._longRest(p, sid);
        const prev = this._maxFloor.get(sid) ?? 1;
        if (toFloor > prev) this._maxFloor.set(sid, toFloor);
      }
      this.broadcast('combat_log', {
        message: `── Descending to Floor ${toFloor} — long rest taken (HP, rage, Second Wind restored) ──`,
      });
      console.log(`[DungeonRoom] Floor ${toFloor} loaded; ${this.state.players.size} player(s) descended`);
    });

    // ── Hotbar management ─────────────────────────────────────────────────────────
    this.onMessage('assign_hotbar', (client, { itemId, slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const s  = Math.max(0, Math.min(9, Math.floor(Number(slot))));
      const id = String(itemId);
      if (id === 'second_wind' || id === 'rage' || CONSUMABLE_REGISTRY[id]) {
        // Each item may occupy only one hotbar slot — clear any existing binding first.
        for (let i = 0; i < player.hotbar.length; i++) {
          if (player.hotbar[i] === id) player.hotbar[i] = '';
        }
        player.hotbar[s] = id;
      }
    });

    this.onMessage('use_hotbar', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      const s       = Math.max(0, Math.min(9, Math.floor(Number(slot))));
      const binding = player.hotbar[s] ?? '';
      if (!binding) return;

      if (binding === 'second_wind') {
        const heal = applySecondWind(this.state, client.sessionId);
        if (heal !== null) {
          this.broadcast('combat_log', { message: `Second Wind: ${player.class[0].toUpperCase() + player.class.slice(1)} recovers ${heal} HP` });
        }
      } else if (binding === 'rage') {
        this._activateRage(player, client.sessionId);
      } else if (CONSUMABLE_REGISTRY[binding]) {
        this._useConsumable(player, client.sessionId, binding);
      }
    });

    this.setSimulationInterval(
      (dt) => this._tick(dt),
      1000 / SERVER_TICK_RATE_HZ.tier1,
    );
  }

  async onJoin(client, options = {}) {
    const classDef = CLASS_REGISTRY[options.class] ?? DEFAULT_CLASS;

    // Load raider pack from the server-side player store.
    // Falls back to empty (class defaults) if no playerId or player not found.
    const storePlayer = options.playerId ? await getPlayer(options.playerId) : null;
    this._playerIds.set(client.sessionId, options.playerId ?? null);
    const raiderItems = storePlayer
      ? storePlayer.raiderPack.flatMap(({ id, qty }) => Array(qty).fill(id))
      : [];

    // Resolve ability scores: use client-provided point-buy if valid, else class defaults.
    const scores = this._validateAbilityScores(options.abilityScores)
      ? options.abilityScores
      : classDef.baseAbilityScores;

    const conMod = getModifier(scores.con);
    const dexMod = getModifier(scores.dex);
    const maxHp  = classDef.getStartingHp(conMod);

    // Empty pack → class defaults equipped (free starter loadout).
    // Non-empty pack → raider enters unequipped; all items go to bag.
    let startingWeapon, startingArmor, ac;
    if (raiderItems.length === 0) {
      startingWeapon = classDef.startingWeaponId;
      startingArmor  = classDef.startingArmorId;
      if (!startingArmor && classDef.unarmoredDefense) {
        ac = 10 + dexMod + getModifier(scores[classDef.unarmoredDefense]);
      } else {
        ac = computeAC(ARMOR_REGISTRY[startingArmor], dexMod, false);
      }
    } else {
      startingWeapon = '';
      startingArmor  = '';
      ac = classDef.unarmoredDefense
        ? 10 + dexMod + getModifier(scores[classDef.unarmoredDefense])
        : computeAC(null, dexMod, false);
    }

    const spawn = FLOOR_REGISTRY[this.state.floor]?.playerSpawn ?? { x: 0, y: 0 };
    const player = new PlayerState();
    player.x     = spawn.x;
    player.y     = spawn.y;
    player.hp    = maxHp;
    player.maxHp = maxHp;
    player.ac    = ac;
    player.level = 1;
    player.alive = true;
    player.class            = classDef.id;
    player.equippedWeaponId = startingWeapon;
    player.equippedArmorId  = startingArmor;
    // Store ability scores on the player so all systems (combat, saves, AC recompute)
    // read from one place rather than re-looking up class defaults each time.
    player.str = scores.str;
    player.dex = scores.dex;
    player.con = scores.con;
    player.int = scores.int;
    player.wis = scores.wis;
    player.cha = scores.cha;
    for (const feature of classDef.classFeatures) player.hotbar.push(feature);
    for (let i = classDef.classFeatures.length; i < 10; i++) player.hotbar.push('');
    player.rageUsesRemaining = classDef.rageUses ?? 0;
    for (const id of raiderItems) player.inventory.push(id);

    if (raiderItems.length > 0) {
      // Auto-equip first weapon, armor, and shield found in bag.
      for (const id of [...player.inventory]) {
        if (!player.equippedWeaponId && WEAPON_REGISTRY[id]) {
          player.inventory.splice(player.inventory.indexOf(id), 1);
          player.equippedWeaponId = id;
        } else if (!player.equippedArmorId && ARMOR_REGISTRY[id]) {
          player.inventory.splice(player.inventory.indexOf(id), 1);
          player.equippedArmorId = id;
        } else if (!player.offhandId && SHIELD_REGISTRY[id]) {
          const twoHanded = WEAPON_REGISTRY[player.equippedWeaponId]?.properties?.includes('two-handed');
          if (!twoHanded) {
            player.inventory.splice(player.inventory.indexOf(id), 1);
            player.offhandId = id;
          }
        }
      }
      this._recomputeStats(player);
    }

    // Auto-assign consumables to the first available hotbar slots.
    for (const id of [...player.inventory]) {
      if (!CONSUMABLE_REGISTRY[id]) continue;
      let alreadyBound = false;
      for (let i = 0; i < player.hotbar.length; i++) {
        if (player.hotbar[i] === id) { alreadyBound = true; break; }
      }
      if (alreadyBound) continue;
      let slot = -1;
      for (let i = 0; i < player.hotbar.length; i++) {
        if (player.hotbar[i] === '') { slot = i; break; }
      }
      if (slot === -1) break;
      player.hotbar[slot] = id;
    }

    this.state.players.set(client.sessionId, player);
    this._runStartedAt.set(client.sessionId, Date.now());
    this._maxFloor.set(client.sessionId, this.state.floor);
    console.log(`[DungeonRoom] ${client.sessionId} joined as ${classDef.id} — HP ${maxHp} AC ${player.ac} STR ${player.str} DEX ${player.dex} CON ${player.con}`);
  }

  onLeave(client) {
    const playerId = this._playerIds.get(client.sessionId);
    if (playerId && !this._extracted.has(client.sessionId)) {
      const player = this.state.players.get(client.sessionId);
      const meta   = this._buildRunMeta(client.sessionId, player);
      commitDeath(playerId, meta).catch(err =>
        console.error('[DungeonRoom.onLeave] commitDeath failed:', err));
    }
    releaseLocksHeldBy(this.state, client.sessionId);
    this.state.players.delete(client.sessionId);
    this._playerIds.delete(client.sessionId);
    this._extracted.delete(client.sessionId);
    this._runStartedAt.delete(client.sessionId);
    this._maxFloor.delete(client.sessionId);
  }

  onDispose() {
    console.log('[DungeonRoom] disposed');
  }

  // ── Floor loading ─────────────────────────────────────────────────────────────

  /**
   * Tear down the current floor's entities and load floor `n` from FLOOR_REGISTRY.
   * Players are not modified here — descend handler resets position + rests them.
   * Initial onCreate call: just populates floor 1 against empty state.
   */
  _loadFloor(n) {
    const floor = FLOOR_REGISTRY[n];
    if (!floor) {
      console.warn(`[DungeonRoom] _loadFloor: no floor data for ${n}`);
      return;
    }

    // MapSchema.clear() always emits OPERATION.CLEAR to the change tracker —
    // even on an empty map. Calling it during the initial onCreate load would
    // make the joining client process snapshot-add then clear+re-add, double-
    // firing onAdd and leaving orphan gfx at spawn. Guard each clear on size.
    if (this.state.enemies.size > 0) this.state.enemies.clear();
    if (this.state.chests.size  > 0) this.state.chests.clear();
    if (this.state.traps.size   > 0) this.state.traps.clear();
    if (this.state.stairs.size  > 0) this.state.stairs.clear();
    this._enemyDefs.clear();
    this._lootRolled.clear();

    for (const e of floor.enemies) {
      const def = ENEMY_REGISTRY[e.type];
      if (!def) {
        console.warn(`[DungeonRoom] unknown enemy type '${e.type}' on floor ${n}`);
        continue;
      }
      this._spawnEnemy(e.id, def, { x: e.x, y: e.y });
    }
    for (const c of floor.chests) {
      const chest = new ChestState();
      chest.id   = c.id;
      chest.x    = c.x;
      chest.y    = c.y;
      chest.open = false;
      for (const item of c.items) chest.items.push(item);
      this.state.chests.set(c.id, chest);
    }
    for (const t of floor.traps) {
      const trap = new TrapState();
      trap.id = t.id;
      trap.x  = t.x;
      trap.y  = t.y;
      trap.cooldownMs = 0;
      this.state.traps.set(t.id, trap);
    }
    for (const s of floor.stairs) {
      const stair = new StairState();
      stair.id      = s.id;
      stair.x       = s.x;
      stair.y       = s.y;
      stair.toFloor = s.toFloor;
      stair.locked  = !!s.lockedUntilAllEnemiesDead;
      this.state.stairs.set(s.id, stair);
    }

    this.state.floor = n;
    this._bounds.minX = WALL;
    this._bounds.maxX = floor.width  - WALL;
    this._bounds.minY = WALL;
    this._bounds.maxY = floor.height - WALL;

    console.log(`[DungeonRoom] Floor ${n} loaded: ${floor.enemies.length} enemies, ${floor.chests.length} chests, ${floor.traps.length} traps, ${floor.stairs.length} stairs (${floor.width}x${floor.height})`);
  }

  _spawnEnemy(id, def, pos) {
    const enemy = new EnemyState();
    enemy.id      = id;
    enemy.type    = def.id;
    enemy.x       = pos.x;
    enemy.y       = pos.y;
    enemy.hp      = def.hp;
    enemy.maxHp   = def.hp;
    enemy.ac      = def.ac;
    enemy.alive   = true;
    enemy.aiState = 'idle';
    this.state.enemies.set(id, enemy);
    this._enemyDefs.set(id, def);
  }

  /**
   * SRD-style long rest: HP to max, temp HP cleared, Second Wind + rage uses
   * refreshed, all timed conditions dropped (rage, bless, longstrider, false
   * life). Called for each player on descend.
   */
  _longRest(player, sessionId) {
    player.hp     = player.maxHp;
    player.tempHp = 0;
    player.secondWindAvailable = true;

    const classDef = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
    player.rageUsesRemaining = classDef.rageUses ?? 0;

    player.rageRemainingMs        = 0;
    player.blessRemainingMs       = 0;
    player.longstriderRemainingMs = 0;
    player.falseLifeRemainingMs   = 0;
    while (player.conditions.length > 0) player.conditions.pop();

    const prefix = `${sessionId}_`;
    for (const key of [...this._conditionTimers.keys()]) {
      if (key.startsWith(prefix)) this._conditionTimers.delete(key);
    }
  }

  // ── Per-tick logic ────────────────────────────────────────────────────────────

  _tick(dt) {
    MovementSystem.update(this.state, dt, this._bounds);

    const aiLogs = AISystem.update(this.state, dt, this._enemyDefs, MELEE_HIT_RANGE_PX);
    for (const msg of aiLogs) this.broadcast('combat_log', { message: msg });

    for (const [sessionId, player] of this.state.players) {
      if (player.alive) this._checkTraps(player, sessionId);
    }

    this._tickTraps(dt);
    this._tickConditions(dt);
    this._rollLootForFreshDeaths();
    tickContainerLocks(this.state, CHEST_LOOT_RANGE_PX);

    // Stair unlock: any stair gated on enemies-dead flips open the first tick
    // after the last enemy dies. The transition fires once per stair (locked=false
    // is the gate to the broadcast). A floor with no stairs is a no-op.
    if (this.state.stairs.size > 0) {
      const allDead = [...this.state.enemies.values()].every(e => !e.alive);
      if (allDead) {
        for (const [, stair] of this.state.stairs) {
          if (stair.locked) {
            stair.locked = false;
            this.broadcast('combat_log', {
              message: `Stair to Floor ${stair.toFloor} unlocked.`,
            });
          }
        }
      }
    }
  }

  /**
   * For each enemy that died this tick (first time we see alive=false), look up
   * its loot table and roll once. Idempotent via `_lootRolled` guard so this can
   * run every tick without re-rolling. Enemies with no table drop nothing silently.
   */
  _rollLootForFreshDeaths() {
    for (const [id, enemy] of this.state.enemies) {
      if (enemy.alive) continue;
      if (this._lootRolled.has(id)) continue;
      this._lootRolled.add(id);

      const table = LOOT_TABLE_REGISTRY[enemy.type];
      if (!table) continue;

      const { gold, items } = rollLoot(table);
      enemy.lootGold = gold;
      for (const itemId of items) enemy.lootItems.push(itemId);
      console.log(`[DungeonRoom] ${enemy.type} (${id}) dropped: ${gold} gp, items=[${items.join(', ')}]`);
    }
  }

  _checkTraps(player, sessionId) {
    for (const [, trap] of this.state.traps) {
      if (trap.cooldownMs > 0) continue;
      const dx = player.x - trap.x;
      const dy = player.y - trap.y;
      if (Math.sqrt(dx * dx + dy * dy) > TRAP_RADIUS_PX) continue;

      const classDef = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
      const creature = {
        abilityScores: { str: player.str, dex: player.dex, con: player.con,
                         int: player.int, wis: player.wis, cha: player.cha },
        level:         player.level,
        saveProfs:     classDef.saveProficiencies,
      };
      const save        = resolveSave({ creature, ability: 'dex', dc: TRAP_SAVE_DC });
      let trapDamage = Math.max(1, save.success ? Math.floor(TRAP_DAMAGE / 2) : TRAP_DAMAGE);
      // Rage: resistance to piercing damage (SRD).
      if (player.conditions.includes('rage')) trapDamage = Math.max(1, Math.floor(trapDamage / 2));
      // Temp HP absorbs trap damage before regular HP (SRD rule).
      if (player.tempHp > 0) {
        const absorbed = Math.min(player.tempHp, trapDamage);
        player.tempHp -= absorbed;
        trapDamage    -= absorbed;
      }
      player.hp = Math.max(0, player.hp - trapDamage);
      if (player.hp <= 0) { player.hp = 0; player.alive = false; }
      trap.cooldownMs = TRAP_COOLDOWN_MS;

      const outcome = save.success
        ? `saved (${save.total} vs DC ${TRAP_SAVE_DC}) — ${trapDamage} dmg (half)`
        : `failed (${save.total} vs DC ${TRAP_SAVE_DC}) — ${trapDamage} dmg`;
      this.broadcast('combat_log', { message: `⚠ Spike Trap  DEX save: ${outcome}, piercing` });
    }
  }

  _tickTraps(dt) {
    for (const [, trap] of this.state.traps) {
      if (trap.cooldownMs > 0) trap.cooldownMs = Math.max(0, trap.cooldownMs - dt);
    }
  }

  _tickConditions(dt) {
    for (const [sessionId, player] of this.state.players) {
      for (const condition of [...player.conditions]) {
        const key       = `${sessionId}_${condition}`;
        const remaining = (this._conditionTimers.get(key) ?? 0) - dt;
        if (remaining <= 0) {
          this._conditionTimers.delete(key);
          const idx = player.conditions.indexOf(condition);
          if (idx !== -1) player.conditions.splice(idx, 1);
          if (condition === 'bless')       player.blessRemainingMs = 0;
          if (condition === 'longstrider') player.longstriderRemainingMs = 0;
          if (condition === 'false_life')  { player.falseLifeRemainingMs = 0; player.tempHp = 0; }
          if (condition === 'rage') {
            player.rageRemainingMs = 0;
            const cn = player.class[0].toUpperCase() + player.class.slice(1);
            this.broadcast('combat_log', { message: `${cn}'s Rage ends.` });
          }
        } else {
          this._conditionTimers.set(key, remaining);
          if (condition === 'bless')       player.blessRemainingMs = remaining;
          if (condition === 'longstrider') player.longstriderRemainingMs = remaining;
          if (condition === 'false_life')  player.falseLifeRemainingMs = remaining;
          if (condition === 'rage')        player.rageRemainingMs = remaining;
        }
      }
    }
  }

  // ── Item / ability helpers ────────────────────────────────────────────────────

  _useConsumable(player, sessionId, consumableId) {
    const idx = player.inventory.indexOf(consumableId);
    if (idx === -1) return;
    const c         = CONSUMABLE_REGISTRY[consumableId];
    const className = player.class[0].toUpperCase() + player.class.slice(1);

    if (c.type === 'healing') {
      const heal = rollDice(c.damageDice.count, c.damageDice.sides) + c.diceBonus;
      player.hp  = Math.min(player.maxHp, player.hp + heal);
      this.broadcast('combat_log', { message: `${c.label}: ${className} recovers ${heal} HP` });
    } else if (c.type === 'bless') {
      if (!player.conditions.includes('bless')) {
        player.conditions.push('bless');
        player.blessRemainingMs = c.conditionDurationMs;
        this._conditionTimers.set(`${sessionId}_bless`, c.conditionDurationMs);
        this.broadcast('combat_log', {
          message: `${c.label}: ${className} gains Bless (+1d4 to attacks, ${c.conditionDurationMs / 1000}s)`,
        });
      }
    } else if (c.type === 'longstrider') {
      if (!player.conditions.includes('longstrider')) {
        player.conditions.push('longstrider');
      }
      player.longstriderRemainingMs = c.conditionDurationMs;
      this._conditionTimers.set(`${sessionId}_longstrider`, c.conditionDurationMs);
      this.broadcast('combat_log', {
        message: `${c.label}: ${className}'s speed +${c.speedBonusFt}ft (${c.conditionDurationMs / 1000}s)`,
      });
    } else if (c.type === 'false_life') {
      const tempHp = rollDice(c.damageDice.count, c.damageDice.sides) + c.diceBonus;
      player.tempHp = tempHp;
      if (!player.conditions.includes('false_life')) {
        player.conditions.push('false_life');
      }
      player.falseLifeRemainingMs = c.conditionDurationMs;
      this._conditionTimers.set(`${sessionId}_false_life`, c.conditionDurationMs);
      this.broadcast('combat_log', {
        message: `${c.label}: ${className} gains ${tempHp} temp HP (${c.conditionDurationMs / 1000}s)`,
      });
    } else if (c.type === 'extract') {
      // Sets the run-complete phase. Client (DungeonScene) watches state.phase
      // and routes to the run-summary overlay. This is the only non-death exit.
      this.state.phase = 'complete';
      this.broadcast('combat_log', {
        message: `${c.label}: ${className} vanishes in a flash of light.`,
      });
    }

    player.inventory.splice(idx, 1);
    // Only clear the hotbar binding when the last copy is consumed; if more
    // copies remain the slot stays active so the player doesn't have to remap.
    if (![...player.inventory].includes(consumableId)) {
      for (let i = 0; i < player.hotbar.length; i++) {
        if (player.hotbar[i] === consumableId) { player.hotbar[i] = ''; break; }
      }
    }

    if (c.type === 'extract') {
      this._extracted.add(sessionId);
      const playerId = this._playerIds.get(sessionId);
      if (playerId) {
        commitExtract(playerId, {
          survivingItems: Array.from(player.inventory),
          goldEarned:     player.gold,
          ...this._buildRunMeta(sessionId, player),
        }).catch(err => console.error('[DungeonRoom] commitExtract failed:', err));
      }
    }
  }

  /**
   * Build the run_history metadata block for a player at the moment of run-end.
   * `player` may be undefined if onLeave fires after state.players has been
   * cleared by some other path — in that case classId falls back to 'unknown'
   * so the row still inserts (the dungeon attempted a run; no class is the
   * data we have).
   */
  _buildRunMeta(sessionId, player) {
    const startedAt = this._runStartedAt.get(sessionId) ?? Date.now();
    return {
      classId:       player?.class || 'unknown',
      floorsReached: this._maxFloor.get(sessionId) ?? 1,
      kills:         0, // deferred; see Phase 3 #3 plan
      runDurationS:  Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    };
  }

  _activateRage(player, sessionId) {
    if (player.rageUsesRemaining <= 0 || player.rageRemainingMs > 0) return;
    player.rageUsesRemaining -= 1;
    player.rageRemainingMs = RAGE_DURATION_MS;
    if (!player.conditions.includes('rage')) player.conditions.push('rage');
    this._conditionTimers.set(`${sessionId}_rage`, RAGE_DURATION_MS);
    const cn = player.class[0].toUpperCase() + player.class.slice(1);
    this.broadcast('combat_log', {
      message: `💢 ${cn} enters a Rage! (+${RAGE_DAMAGE_BONUS} dmg, resist physical, 30s)`,
    });
  }

  /**
   * Validate a client-provided abilityScores object against the point buy rules.
   * Returns true only if all six scores are present, in range, and within budget.
   * A false result causes onJoin to fall back to classDef.baseAbilityScores silently.
   */
  _validateAbilityScores(scores) {
    const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    if (!scores || typeof scores !== 'object') return false;
    if (!keys.every(k => typeof scores[k] === 'number')) return false;
    if (!keys.every(k => scores[k] >= SCORE_MIN && scores[k] <= SCORE_MAX)) return false;
    const cost = keys.reduce((sum, k) => sum + (POINT_COST[scores[k]] ?? 999), 0);
    return cost <= POINT_BUY_BUDGET;
  }

  /**
   * Recompute all derived stats from the player's current ability scores and equipment.
   * Call this whenever scores or equipment change (equip/unequip, Potion of Giant Strength,
   * racial bonus, level-up ASI, etc.).
   *
   * Future additions: attack modifier, initiative, spell save DC.
   */
  _recomputeStats(player) {
    const classDef  = CLASS_REGISTRY[player.class] ?? DEFAULT_CLASS;
    const dexMod    = getModifier(player.dex);
    const hasShield = !!SHIELD_REGISTRY[player.offhandId];
    if (!player.equippedArmorId && !hasShield && classDef.unarmoredDefense) {
      const udMod = getModifier(player[classDef.unarmoredDefense]);
      player.ac = 10 + dexMod + udMod;
    } else {
      player.ac = computeAC(ARMOR_REGISTRY[player.equippedArmorId] ?? null, dexMod, hasShield);
    }
  }
}
