// client/src/network/ColyseusClient.js
// Thin wrapper around the Colyseus.js browser SDK.
// Manages connection lifecycle and exposes the room for scenes to consume.
// One room join at a time — call leave() before joining another.

import { Client } from 'colyseus.js';

const colyseusUrl = import.meta.env.VITE_COLYSEUS_URL || 'ws://localhost:2567';

let _client = null;
let _room = null;

/** @returns {Client} */
function getClient() {
  if (!_client) {
    _client = new Client(colyseusUrl);
  }
  return _client;
}

/**
 * Join (or create) the dungeon room.
 * @returns {Promise<import('colyseus.js').Room>}
 */
export async function joinDungeon(opts = {}) {
  if (_room) return _room;
  _room = await getClient().joinOrCreate('dungeon', opts);
  console.log('[ColyseusClient] Joined dungeon room:', _room.sessionId);
  return _room;
}

/**
 * Send a move direction to the server.
 * @param {number} dx - normalized X direction (-1, 0, 1)
 * @param {number} dy - normalized Y direction (-1, 0, 1)
 */
export function sendMove(dx, dy) {
  _room?.send('move', { dx, dy });
}

/** Tell the server the player has stopped moving. */
export function sendStop() {
  _room?.send('stop');
}

/** Tell the server the player is attacking. */
export function sendAttack() {
  _room?.send('attack');
}

/**
 * Equip an item from inventory into a slot.
 * @param {string} itemId
 * @param {'weapon'|'offhand'|null} [slot] - null lets the server auto-detect
 */
export function sendEquip(itemId, slot = null) {
  _room?.send('equip', { itemId, slot });
}

/**
 * Unequip the item in a given slot.
 * @param {'weapon'|'offhand'} slot
 */
export function sendUnequip(slot) {
  _room?.send('unequip', { slot });
}

/** Loot a chest by id. */
export function sendLoot(chestId) {
  _room?.send('loot', { chestId });
}

/** Loot a dead enemy's corpse by id. */
export function sendLootCorpse(enemyId) {
  _room?.send('loot_corpse', { enemyId });
}

/**
 * Assign an item or ability to a hotbar slot.
 * @param {string} itemId - consumable id or 'second_wind'
 * @param {number} slot   - 0-9
 */
export function sendAssignHotbar(itemId, slot) {
  _room?.send('assign_hotbar', { itemId, slot });
}

/**
 * Use whatever is bound to a hotbar slot.
 * @param {number} slot - 0-9
 */
export function sendUseHotbar(slot) {
  _room?.send('use_hotbar', { slot });
}

/** Cleanly leave the current room. */
export async function leave() {
  if (_room) {
    await _room.leave();
    _room = null;
  }
}

/** @returns {import('colyseus.js').Room | null} */
export function getRoom() {
  return _room;
}
