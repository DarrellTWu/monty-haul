// shared/data/constants.js
// ─────────────────────────────────────────────────────────────────
// Global tuning constants. All numeric values that affect game feel live here.
// Edit this file first for balance changes — do not scatter literals in logic files.
// Imported by both client (display) and server (authoritative resolution).

// SERVER TICK RATE
// 20Hz is correct for this genre — 3-second attack cooldowns mean 60Hz is
// wasted resolution. 20Hz with client-side interpolation is the genre standard.
// Tier 4 at 48 players may need to drop further — tune empirically.
export const SERVER_TICK_RATE_HZ = {
  tier1: 20, // Floors 1-3  —  4 players, comfortable headroom
  tier2: 20, // Floors 4-6  — 12 players, still comfortable
  tier3: 15, // Floors 7-9  — 24 players, reduce proactively
  tier4: 10, // Floor 10    — 48 players, minimum viable authority
};

// SURVIVAL
export const HP_MULTIPLIER = 2.0;        // Base HP × this value at run start
export const OOC_REGEN_RATE = 2;         // HP per second restored out of combat
export const OOC_REGEN_DELAY_MS = 3000;  // Ms after last hit before regen starts
export const COMBAT_DETECTION_RADIUS = 200; // Px — enemy within this = in combat

// COMBAT
export const ATTACK_COOLDOWN_MS = 3000;  // Player attack timer cooldown
export const MELEE_ATTACK_RANGE_PX = 25; // Weapon reach in pixels (from attacker edge)
export const MELEE_HIT_RANGE_PX = 64;   // Center-to-center distance for melee hit check.
                                          // Generous for placeholder graphics; tune when real
                                          // sprite collision radii are known.
export const CRIT_MULTIPLIER = 2;        // Total damage multiplier on a natural 20

// MOVEMENT
export const BASE_SPEED_PX_PER_SEC = 150; // 30 ft at 5 px/ft
export const DASH_SPEED_MULTIPLIER = 2.0; // Speed multiplier while Dashing

// EXTRACTION
export const RITUAL_DURATION_MS = 60000; // 60 seconds to complete an extraction ritual
export const RITUAL_RADIUS_PX = 120;     // Player must remain within this px of portal

// LEVER MECHANIC
export const LEVER_RESET_MS = 4000;      // First lever resets after this ms — calibrate to exceed max crossing time

// INTERACTION
export const CHEST_LOOT_RANGE_PX = 80;  // Player must be within this px of a chest to loot it

// TRAPS
export const TRAP_DAMAGE      = 4;     // Spike trap base damage (DEX save for half)
export const TRAP_SAVE_DC     = 12;    // DEX save difficulty class
export const TRAP_RADIUS_PX   = 40;    // Trigger radius (center-to-center)
export const TRAP_COOLDOWN_MS = 5000;  // Cooldown before trap can trigger again

// META
export const BANK_SLOTS_PER_RUN = 2;     // Max items a player can bank mid-run
export const LONG_REST_ON_LEVEL_UP = true; // Full HP/resource restore on each floor clear
