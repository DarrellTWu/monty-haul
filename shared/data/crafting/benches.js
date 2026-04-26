// shared/data/crafting/benches.js
// Hub workbench registry — six benches per crafting GDD §6.
// `status: 'open'` benches expose recipes; `status: 'planned'` benches render a
// "Coming soon" placeholder using the blurb. Order here drives display order.

export const BENCH_REGISTRY = {
  forge: {
    id: 'forge',
    label: 'Forge',
    blurb: 'Physical base items — weapons, armor, material variants.',
    status: 'open',
  },
  binder: {
    id: 'binder',
    label: 'Binder',
    blurb: "Class identity — Class Enchants and socket operations.",
    status: 'planned',
  },
  artificer: {
    id: 'artificer',
    label: 'Artificer',
    blurb: 'Property Gems, gadgets, and dungeon tools.',
    status: 'planned',
  },
  apothecary: {
    id: 'apothecary',
    label: 'Apothecary',
    blurb: 'Run sustainability — potions, elixirs, resistance buffs.',
    status: 'open',
  },
  scriptorium: {
    id: 'scriptorium',
    label: 'Scriptorium',
    blurb: 'Scrolls, recipe restoration, fragment assembly, map intel.',
    status: 'planned',
  },
  refinery: {
    id: 'refinery',
    label: 'Refinery',
    blurb: 'Material economy — tier conversion and surplus management.',
    status: 'planned',
  },
};
