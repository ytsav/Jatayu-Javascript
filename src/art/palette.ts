export type RGB = readonly [number, number, number];

export interface PigmentInfo {
  id: string;
  name: string;
  hex: string;
  rgb: RGB;
  note: string;
}

export const PALETTE = {
  indigoNight: [23, 22, 48] as RGB,
  twilightPlum: [48, 38, 80] as RGB,
  dustyLavender: [98, 78, 132] as RGB,
  ovaCerulean: [54, 102, 138] as RGB,
  celadonMist: [110, 158, 166] as RGB,
  seafoamGlow: [182, 210, 198] as RGB,
  sakuraDusk: [222, 118, 136] as RGB,
  peachSoju: [244, 158, 112] as RGB,
  honeyAmber: [246, 194, 98] as RGB,
  sunlightCream: [254, 239, 198] as RGB,
  boneChalk: [255, 249, 236] as RGB,
  willowCharcoal: [24, 21, 30] as RGB,
  umberInk: [56, 40, 38] as RGB,
  sanguineConte: [172, 72, 52] as RGB,
  timberOchre: [128, 86, 60] as RGB,
  mossTeal: [34, 66, 70] as RGB,
  sageReed: [88, 120, 86] as RGB,
  blossomCoral: [240, 126, 114] as RGB,
} as const;

export const CURATED_PIGMENTS: PigmentInfo[] = [
  {
    id: 'indigoNight',
    name: 'Zenith Indigo',
    hex: '#171630',
    rgb: PALETTE.indigoNight,
    note: 'Upper twilight sky and deep architectural stillness',
  },
  {
    id: 'dustyLavender',
    name: 'OVA Dusk Violet',
    hex: '#624E84',
    rgb: PALETTE.dustyLavender,
    note: 'Velvety cloud shadows and nostalgic twilight haze',
  },
  {
    id: 'ovaCerulean',
    name: 'Celulean Mist',
    hex: '#36668A',
    rgb: PALETTE.ovaCerulean,
    note: 'Crisp late-afternoon depth before sunset warms',
  },
  {
    id: 'celadonMist',
    name: 'Seafoam Horizon',
    hex: '#6E9EA6',
    rgb: PALETTE.celadonMist,
    note: 'Cool atmospheric breath bridging dusk and firelight',
  },
  {
    id: 'sakuraDusk',
    name: 'Sakura Rose',
    hex: '#DE7688',
    rgb: PALETTE.sakuraDusk,
    note: 'Celebratory warmth along sunlit cumulus edges',
  },
  {
    id: 'peachSoju',
    name: 'Peach Apricot',
    hex: '#F49E70',
    rgb: PALETTE.peachSoju,
    note: 'Effervescent warmth, camaraderie, and summer glow',
  },
  {
    id: 'honeyAmber',
    name: 'Gilded Amber',
    hex: '#F6C262',
    rgb: PALETTE.honeyAmber,
    note: 'Breakthrough light shafts and quiet hearth lanterns',
  },
  {
    id: 'sunlightCream',
    name: 'Sunlight Cream',
    hex: '#FEEFC6',
    rgb: PALETTE.sunlightCream,
    note: 'Incandescent radiance and water-ripple highlights',
  },
  {
    id: 'sanguineConte',
    name: 'Sanguine Conté',
    hex: '#AC4834',
    rgb: PALETTE.sanguineConte,
    note: 'Warm timber accents, terracotta hearth, and petals',
  },
  {
    id: 'willowCharcoal',
    name: 'Carbon Charcoal',
    hex: '#18151E',
    rgb: PALETTE.willowCharcoal,
    note: 'Human gesture underdrawing, grasses, and deep anchor shadows',
  },
];
