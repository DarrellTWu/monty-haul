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
export async function joinDungeon() {
  if (_room) return _room;
  _room = await getClient().joinOrCreate('dungeon');
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
 * Equip a weapon by id.
 * @param {string} itemId - weapon id matching server's WEAPON_REGISTRY
 */
export function sendEquip(itemId) {
  _room?.send('equip', { itemId });
}

/**
 * Unequip the item in a given slot.
 * @param {'weapon'|'shield'} slot
 */
export function sendUnequip(slot) {
  _room?.send('unequip', { slot });
}

/**
 * Loot a chest by id.
 * @param {string} chestId
 */
export function sendLoot(chestId) {
  _room?.send('loot', { chestId });
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
