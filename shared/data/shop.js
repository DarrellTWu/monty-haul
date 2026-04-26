// shared/data/shop.js
// Hub vendor catalog. Two vendors, infinite stock. Prices are SRD-approximate
// (PHB equipment table for armor; potions extrapolated from Healing Potion = 50 gp).
// Order within each list is ascending price — display layer relies on it.

export const VENDOR_CATALOG = {
  potions: [
    { id: 'healing_potion',     price: 50  },
    { id: 'longstrider_potion', price: 75  },
    { id: 'false_life_potion',  price: 100 },
    { id: 'bless_potion',       price: 250 },
  ],
  armor: [
    { id: 'padded',          price: 5    },
    { id: 'leather',         price: 10   },
    { id: 'hide',            price: 10   },
    { id: 'ring_mail',       price: 30   },
    { id: 'studded_leather', price: 45   },
    { id: 'chain_shirt',     price: 50   },
    { id: 'scale_mail',      price: 50   },
    { id: 'chain_mail',      price: 75   },
    { id: 'splint',          price: 200  },
    { id: 'breastplate',     price: 400  },
    { id: 'half_plate',      price: 750  },
    { id: 'plate',           price: 1500 },
  ],
};
