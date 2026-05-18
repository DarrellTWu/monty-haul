// server/rooms/DungeonRoom.js
import { createRequire } from 'module';
const { Room } = createRequire(import.meta.url)('colyseus');

import { GameState }  from '../state/GameState.js';
import { PlayerState } from '../state/PlayerState.js';
import { EnemyState }  from '../state/EnemyState.js';
import { ChestState }  from '../state/ChestState.js';
import { TrapState }   from '../state/TrapState.js';
import { StairState }  from '../state/StairState.js';
import { DoorState }   from '../state/DoorState.js';

import { CLASS_REGISTRY, DEFAULT_CLASS } from '../../shared/data/classes/index.js';
import { GOBLIN, DOG, SKELETON }     from '../../shared/data/enemies/tier1.js';
import { FLOOR_REGISTRY }            from '../../shared/data/floors/index.js';
import { getModifier, resolveSave, rollDice } from '../../shared/logic/combat.js';
import { applyDeathLoot }            from '../../shared/logic/loot.js';
import { pointInRect }               from '../../shared/logic/geometry.js';
import { validateAbilityScores }     from '../../shared/logic/character.js';
import { equipItem, unequipItem, recomputeStats } from '../../shared/logic/equipment.js';
import { applyClassLevel, getEligibleClassChoicesForLevelUp, computeHpGainForLevel } from '../../shared/logic/class-progression.js';
import {
  tryOpenContainer, tryCloseContainer, releaseLocksHeldBy, tickContainerLocks,
  tryTakeItem, tryTakeGold, tryDropItem,
} from '../../shared/logic/loot-window.js';
import { applyCondition, tickConditions, clearPlayerConditions } from '../../shared/logic/conditions.js';
import { LOOT_TABLE_REGISTRY }       from '../../shared/data/loot/tier1.js';
import { ARMOR_REGISTRY }            from '../../shared/data/armor/armor.js';
import { WEAPON_REGISTRY }           from '../../shared/data/weapons/index.js';
import { SHIELD_REGISTRY }           from '../../shared/data/items/shields.js';
import { CONSUMABLE_REGISTRY }       from '../../shared/data/items/consumables.js';
import {
  SERVER_TICK_RATE_HZ, MELEE_HIT_RANGE_PX, CHEST_LOOT_RANGE_PX,
  TRAP_DAMAGE, TRAP_SAVE_DC, TRAP_RADIUS_PX, TRAP_COOLDOWN_MS,
  RAGE_DURATION_MS, RAGE_DAMAGE_BONUS,
} from '../../shared/data/constants.js';

import * as MovementSystem from '../systems/MovementSystem.js';
import * as AISystem       from '../systems/AISystem.js';
import { playerAttack, enemyAttack, applySecondWind } from '../systems/CombatSystem.js';
import { getPlayer, commitExtract, commitDeath } from '../store/playerStore.js';

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
    // Floor geometry — static per floor, populated by _loadFloor.
    // Walls + platforms aren't synced (no runtime mutation); door lock state
    // lives on state.doors (synced). Rooms are AI-navigation hints.
    this._floorWalls      = [];
    this._floorPlatforms  = [];
    this._floorRooms      = [];

    this._loadFloor(1);

    // ── Movement ──────────────────────────────────────────────────────────────────
    this.onMessage('move', (client, { dx, dy }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      if (player.pendingLevelUp) { player.vx = 0; player.vy = 0; return; }
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) { player.vx = 0; player.vy = 0; }
      else           { player.vx = dx / len; player.vy = dy / len; }
    });

    this.onMessage('stop', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) { player.vx = 0; player.vy = 0; }
    });

    // ── Combat ────────────────────────────────────────────────────────────────────
    this.onMessage('attack', (client, payload = {}) => {
      const p = this.state.players.get(client.sessionId);
      if (p?.pendingLevelUp) return;
      const targetId = payload.targetId ?? null;
      // Build the LoS obstacle list once per attack: static walls + currently-locked
      // doors. Unlocked doors don't block LoS (consistent with movement rules).
      const obstacles = [...this._floorWalls];
      for (const [, door] of this.state.doors) {
        if (door.locked) obstacles.push({ x: door.x, y: door.y, w: door.w, h: door.h });
      }
      const result = playerAttack(this.state, client.sessionId, this._enemyDefs, targetId, { obstacles });
      if (result.denied) {
        client.send('attack_denied', { reason: result.denied });
        return;
      }
      for (const msg of result.logs) this.broadcast('combat_log', { message: msg });
      if (result.projectile) this.broadcast('projectile_fired', result.projectile);
    });

    // ── Equip / unequip ───────────────────────────────────────────────────────────
    // Slot routing + SRD constraints live in shared/logic/equipment.js so the
    // logic is testable and shared with any future client-side preview.
    // 'equip'  payload: { itemId, slot? }  — slot auto-detected if omitted
    // 'unequip' payload: { slot }          — 'weapon' | 'offhand' | 'armor'
    this.onMessage('equip', (client, { itemId, slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      equipItem(player, { itemId, slot });
    });

    this.onMessage('unequip', (client, { slot }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      unequipItem(player, { slot });
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
    // Handler only validates the request (alive, stair exists, unlocked, in range)
    // and forwards to `_descendTo`, which performs the floor swap.
    this.onMessage('descend', (client, { stairId }) => {
      const player = this.state.players.get(client.sessionId);
      const stair  = this.state.stairs.get(String(stairId));
      if (!player || !player.alive || !stair) return;
      if (stair.locked) return;
      const dx = player.x - stair.x;
      const dy = player.y - stair.y;
      if (Math.sqrt(dx * dx + dy * dy) > CHEST_LOOT_RANGE_PX) return;
      this._descendTo(stair.toFloor);
    });

    // ── Level-up on descend ───────────────────────────────────────────────────────
    // While `pendingLevelUp` is true, the player can't move or attack. The
    // choice resolves synchronously here; eligibility comes from the
    // progression module (MVP: untaken classes only).
    this.onMessage('choose_level_up', (client, payload = {}) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.pendingLevelUp) return;
      const classId = String(payload.classId ?? '');
      const eligible = getEligibleClassChoicesForLevelUp(player);
      if (!eligible.includes(classId)) return;

      const result = applyClassLevel(player, classId);
      if (!result.ok) return;
      // applyClassLevel handles HP bump + per-class resource init; recompute
      // AC in case a derived feature flipped (Unarmored Defense after Monk
      // multiclass, etc.).
      recomputeStats(player);
      player.pendingLevelUp = false;

      // Seed newly-granted features onto the first empty hotbar slot, if any.
      const newFeatures = result.features ?? [];
      for (const feat of newFeatures) {
        let placed = false;
        for (let i = 0; i < player.hotbar.length; i++) {
          if (player.hotbar[i] === '') { player.hotbar[i] = feat; placed = true; break; }
        }
        if (!placed) {
          this.broadcast('combat_log', {
            message: `${feat} learned — drag to hotbar to use.`,
          });
        }
      }

      // Build summary: "Fighter 1 / Barbarian 1".
      const counts = new Map();
      for (const cid of player.levelUpHistory) {
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
      const parts = [];
      for (const [cid, n] of counts) {
        const name = CLASS_REGISTRY[cid]?.name ?? cid;
        parts.push(`${name} ${n}`);
      }
      const className = CLASS_REGISTRY[classId]?.name ?? classId;
      const pLabel    = player.class ? (player.class[0].toUpperCase() + player.class.slice(1)) : 'Player';
      this.broadcast('combat_log', {
        message: `${pLabel} took a level in ${className} (now ${parts.join(' / ')}).`,
      });
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
    // Single source of truth lives in shared/logic/character.js — see validateAbilityScores.
    const check = validateAbilityScores(options.abilityScores);
    if (!check.ok && options.abilityScores) {
      console.warn(`[DungeonRoom] rejecting client abilityScores from ${client.sessionId}: ${check.error}`);
    }
    const scores = check.ok ? options.abilityScores : classDef.baseAbilityScores;

    const conMod = getModifier(scores.con);

    // Empty pack → class defaults equipped (free starter loadout).
    // Non-empty pack → raider enters unequipped; all items go to bag.
    const startingWeapon = raiderItems.length === 0 ? classDef.startingWeaponId : '';
    const startingArmor  = raiderItems.length === 0 ? classDef.startingArmorId  : '';

    const spawn = FLOOR_REGISTRY[this.state.floor]?.playerSpawn ?? { x: 0, y: 0 };
    const player = new PlayerState();
    player.x     = spawn.x;
    player.y     = spawn.y;
    player.elevation = this._spawnElevation(spawn.x, spawn.y);
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

    // Seed level 1 via the progression module: sets classLevels/levelUpHistory/
    // level + initializes per-class resource pools (rage uses, secondWindAvailable).
    // HP for the join seed uses getStartingHp (max die) — overwrites the 0 the
    // module would leave at level 1 (which intentionally doesn't compute HP).
    const seedResult = applyClassLevel(player, classDef.id);
    const startingHp = classDef.getStartingHp(conMod);
    player.maxHp = startingHp;
    player.hp    = startingHp;

    // Seed hotbar with level-1 features, padded to 10 slots.
    for (const f of seedResult.features) player.hotbar.push(f);
    for (let i = seedResult.features.length; i < 10; i++) player.hotbar.push('');

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
    }
    // Always compute AC from current equip state + derived class features.
    recomputeStats(player);

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
    console.log(`[DungeonRoom] ${client.sessionId} joined as ${classDef.id} — HP ${player.maxHp} AC ${player.ac} STR ${player.str} DEX ${player.dex} CON ${player.con}`);
  }

  onLeave(client) {
    const playerId = this._playerIds.get(client.sessionId);
    if (playerId && !this._extracted.has(client.sessionId)) {
      const player = this.state.players.get(client.sessionId);
      const meta   = this._buildRunMeta(client.sessionId, player);
      commitDeath(playerId, meta).catch(err =>
        // Failure here is logged to dead-letter queue by playerStore. Player
        // already disconnected; nobody to message — operator-driven recovery.
        console.error('[DungeonRoom.onLeave] commitDeath failed (logged to dead-letter):', err));
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
    if (this.state.doors.size   > 0) this.state.doors.clear();
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
    for (const d of floor.doors ?? []) {
      const door = new DoorState();
      door.id     = d.id;
      door.x      = d.x;
      door.y      = d.y;
      door.w      = d.w;
      door.h      = d.h;
      door.locked = !!d.locked;
      this.state.doors.set(d.id, door);
    }

    // Stash static geometry refs for MovementSystem / AISystem.
    this._floorWalls     = floor.walls     ?? [];
    this._floorPlatforms = floor.platforms ?? [];
    this._floorRooms     = floor.rooms     ?? [];

    // Seed elevation on every freshly-spawned enemy based on its spawn position
    // vs the new floor's platforms. Players are seeded by onJoin / descend.
    for (const [, enemy] of this.state.enemies) {
      enemy.elevation = this._spawnElevation(enemy.x, enemy.y);
    }

    this.state.floor = n;
    this._bounds.minX = WALL;
    this._bounds.maxX = floor.width  - WALL;
    this._bounds.minY = WALL;
    this._bounds.maxY = floor.height - WALL;

    console.log(`[DungeonRoom] Floor ${n} loaded: ${floor.enemies.length} enemies, ${floor.chests.length} chests, ${floor.traps.length} traps, ${floor.stairs.length} stairs, ${floor.doors?.length ?? 0} doors, ${floor.platforms?.length ?? 0} platforms (${floor.width}x${floor.height})`);
  }

  /**
   * Look up the elevation an entity should have when spawned at (x, y) on the
   * currently-loaded floor. Returns the platform's elevation if the point is
   * inside any platform rect, otherwise 0.
   */
  _spawnElevation(x, y) {
    for (const p of this._floorPlatforms) {
      if (pointInRect(x, y, p)) return p.elevation ?? 1;
    }
    return 0;
  }

  /**
   * Swap the active floor and reposition every player to the new spawn. Each
   * player takes a long rest (HP/rage/Second Wind restored) and has their max-
   * floor tracker bumped if applicable. The single-room model means the floor
   * changes for everyone — the descend handler is just the trigger.
   */
  _descendTo(toFloor) {
    this._loadFloor(toFloor);
    const floor = FLOOR_REGISTRY[toFloor];
    for (const [sid, p] of this.state.players) {
      p.x  = floor.playerSpawn.x;
      p.y  = floor.playerSpawn.y;
      p.vx = 0; p.vy = 0;
      p.elevation = this._spawnElevation(p.x, p.y);
      this._longRest(p, sid);
      // Force a level-up choice before the player can act on the new floor.
      // Cleared by the `choose_level_up` handler; dead players don't level up.
      if (p.alive) {
        p.pendingLevelUp = true;
        console.log(`[DungeonRoom] ${sid} pendingLevelUp=true on descend to floor ${toFloor} (alive=${p.alive}, level=${p.level})`);
      }
      const prev = this._maxFloor.get(sid) ?? 1;
      if (toFloor > prev) this._maxFloor.set(sid, toFloor);
    }
    this.broadcast('combat_log', {
      message: `── Descending to Floor ${toFloor} — long rest taken (HP, rage, Second Wind restored) ──`,
    });
    console.log(`[DungeonRoom] Floor ${toFloor} loaded; ${this.state.players.size} player(s) descended`);
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

    // Refill rage if the player has taken any level in Barbarian.
    // Reads the rageUses pool off the Barbarian class def directly — it's a
    // per-class resource, not a derived feature.
    const barbLvl = player.classLevels?.get?.('barbarian') ?? 0;
    if (barbLvl > 0) {
      player.rageUsesRemaining = CLASS_REGISTRY.barbarian.rageUses ?? 0;
    }

    clearPlayerConditions(player, this._conditionTimers, sessionId);
  }

  // ── Per-tick logic ────────────────────────────────────────────────────────────

  _tick(dt) {
    MovementSystem.update(this.state, dt, this._bounds, {
      walls:     this._floorWalls,
      platforms: this._floorPlatforms,
    }, this._enemyDefs);

    const aiLogs = AISystem.update(this.state, dt, this._enemyDefs, MELEE_HIT_RANGE_PX, {
      walls:     this._floorWalls,
      platforms: this._floorPlatforms,
      rooms:     this._floorRooms,
    });
    for (const msg of aiLogs) this.broadcast('combat_log', { message: msg });

    for (const [sessionId, player] of this.state.players) {
      if (player.alive) this._checkTraps(player, sessionId);
    }

    this._tickTraps(dt);
    this._tickConditions(dt);
    applyDeathLoot(this.state.enemies, this._lootRolled, LOOT_TABLE_REGISTRY,
      (id, type, gold, items) =>
        console.log(`[DungeonRoom] ${type} (${id}) dropped: ${gold} gp, items=[${items.join(', ')}]`));
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
    const logs = tickConditions(this.state.players, this._conditionTimers, dt);
    for (const msg of logs) this.broadcast('combat_log', { message: msg });
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
      applyCondition(player, 'bless', c.conditionDurationMs, this._conditionTimers, sessionId);
      this.broadcast('combat_log', {
        message: `${c.label}: ${className} gains Bless (+1d4 to attacks, ${c.conditionDurationMs / 1000}s)`,
      });
    } else if (c.type === 'longstrider') {
      applyCondition(player, 'longstrider', c.conditionDurationMs, this._conditionTimers, sessionId);
      this.broadcast('combat_log', {
        message: `${c.label}: ${className}'s speed +${c.speedBonusFt}ft (${c.conditionDurationMs / 1000}s)`,
      });
    } else if (c.type === 'false_life') {
      const tempHp = rollDice(c.damageDice.count, c.damageDice.sides) + c.diceBonus;
      player.tempHp = tempHp;
      applyCondition(player, 'false_life', c.conditionDurationMs, this._conditionTimers, sessionId);
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
        // Survivors = bag + equipped weapon/offhand/armor. Empty slots are '';
        // 'unarmed' is the empty-weapon fallback id and not an equippable item.
        const survivingItems = Array.from(player.inventory);
        if (player.equippedWeaponId && player.equippedWeaponId !== 'unarmed') {
          survivingItems.push(player.equippedWeaponId);
        }
        if (player.offhandId)       survivingItems.push(player.offhandId);
        if (player.equippedArmorId) survivingItems.push(player.equippedArmorId);
        commitExtract(playerId, {
          survivingItems,
          goldEarned:     player.gold,
          ...this._buildRunMeta(sessionId, player),
        }).catch(err => {
          // Failure here means Supabase couldn't be reached after withRetry
          // exhausted. The payload was logged to the dead-letter queue inside
          // playerStore — surface a warning to the player so they know their
          // stash may not reflect this run until ops replays the queue.
          console.error('[DungeonRoom] commitExtract failed:', err);
          this.broadcast('combat_log', {
            message: '⚠ Save to server failed — your run was logged for recovery. Tell an admin.',
          });
        });
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
      // TODO(deferred): kill attribution — see docs/agent-context/combat.md §Kill Attribution.
      kills:         0,
      runDurationS:  Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    };
  }

  _activateRage(player, sessionId) {
    if (player.rageUsesRemaining <= 0 || player.rageRemainingMs > 0) return;
    player.rageUsesRemaining -= 1;
    applyCondition(player, 'rage', RAGE_DURATION_MS, this._conditionTimers, sessionId);
    const cn = player.class[0].toUpperCase() + player.class.slice(1);
    this.broadcast('combat_log', {
      message: `💢 ${cn} enters a Rage! (+${RAGE_DAMAGE_BONUS} dmg, resist physical, 30s)`,
    });
  }

}
