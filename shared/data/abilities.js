// shared/data/abilities.js
// Registry of active class abilities that can live on the hotbar.
// The server's assign_hotbar handler whitelists ids against this registry;
// use_hotbar dispatches on the id after checking the player actually has the
// feature (getGrantedFeatures in shared/logic/class-progression.js).
//
// Display fields (label, hotbarShort, icon, note) are the single source of
// truth for client rendering — no hand-maintained label tables elsewhere.
// `kiCost` marks monk ki abilities; the cost value itself is KI_ABILITY_COST
// in constants.js.

export const ABILITY_REGISTRY = {
  second_wind: {
    id: 'second_wind',
    label: 'Second Wind',
    hotbarShort: '2nd Wind',
    icon: '⚡',
    note: 'Heal 1d10 + fighter level (1/rest)',
  },
  action_surge: {
    id: 'action_surge',
    label: 'Action Surge',
    hotbarShort: 'Surge',
    icon: '⚡',
    note: 'Reset attack timer instantly (1/rest)',
  },
  rage: {
    id: 'rage',
    label: 'Rage',
    hotbarShort: 'Rage',
    icon: '💢',
    note: '+2 dmg, resist phys dmg (30s)',
  },
  reckless_attack: {
    id: 'reckless_attack',
    label: 'Reckless Attack',
    hotbarShort: 'Reckless',
    icon: '💢',
    note: 'Toggle: adv on your melee attacks, foes gain adv on you',
  },
  flurry_of_blows: {
    id: 'flurry_of_blows',
    label: 'Flurry of Blows',
    hotbarShort: 'Flurry',
    icon: '👊',
    kiCost: true,
    note: 'Two bonus unarmed strikes (1 ki)',
  },
  patient_defense: {
    id: 'patient_defense',
    label: 'Patient Defense',
    hotbarShort: 'Patient',
    icon: '🛡',
    kiCost: true,
    note: 'Attackers have disadvantage for 6s (1 ki)',
  },
  cunning_action: {
    id: 'cunning_action',
    label: 'Cunning Action',
    hotbarShort: 'Cunning',
    icon: '🗡',
    note: 'Dash: double speed for 3s (9s cooldown)',
  },
  step_of_wind: {
    id: 'step_of_wind',
    label: 'Step of the Wind',
    hotbarShort: 'StepWind',
    icon: '💨',
    kiCost: true,
    note: 'Dash: double speed for 6s (1 ki)',
  },
};

/** True iff `id` is a hotbar-bindable class ability. */
export const isAbility = (id) => Object.hasOwn(ABILITY_REGISTRY, id);
