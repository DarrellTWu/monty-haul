// shared/data/items/emblems.js
// Subclass-unlock emblem definitions (GDD §5 "Class Unlock Items", MVP form).
// An emblem is a bag item — never equipped, consumed, or hotbar-bound. While
// carried (bag or equipped slots), taking level SUBCLASS_UNLOCK_LEVEL in the
// named class grants the named subclass (see trySubclassUnlock in
// shared/logic/class-progression.js).
//
// Each of the three MVP classes seeds its basic emblem into the free starter
// loadout (classDef.startingItemIds, empty-raider-pack joins only), so every
// fresh character can reach its basic subclass at class level 3. Enhancement
// bonuses and higher-tier unlock items (level caps past 3) are the itemization
// GDD's follow-up — TODO(deferred): gear-driven level caps — see docs/design/gdd.md §5.

export const CHAMPION_SIGIL = {
  id:        'champion_sigil',
  category:  'emblem',
  label:     "Champion's Sigil",
  unlocks:   { classId: 'fighter', subclassId: 'champion' },
  goldValue: 100,
  sortKey:   600,
  note:      'crit on 19–20',
};

export const BERSERKER_TOTEM = {
  id:        'berserker_totem',
  category:  'emblem',
  label:     "Berserker's Totem",
  unlocks:   { classId: 'barbarian', subclassId: 'berserker' },
  goldValue: 100,
  sortKey:   610,
  note:      'Frenzy: extra attack while raging',
};

export const OPEN_HAND_MANUAL = {
  id:        'open_hand_manual',
  category:  'emblem',
  label:     'Manual of the Open Hand',
  unlocks:   { classId: 'monk', subclassId: 'open_hand' },
  goldValue: 100,
  sortKey:   620,
  note:      'Flurry hits stagger the target',
};

export const EMBLEM_REGISTRY = {
  champion_sigil:   CHAMPION_SIGIL,
  berserker_totem:  BERSERKER_TOTEM,
  open_hand_manual: OPEN_HAND_MANUAL,
};
