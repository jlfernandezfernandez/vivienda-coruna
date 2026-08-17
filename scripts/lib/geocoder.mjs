/**
 * Geocoder and coordinate resolution dictionary for A Coruña metropolitan area.
 * Maps neighborhoods, polígonos, and municipalities to precise WGS84 GPS coordinates.
 */

// Precise neighborhood centroids for the metropolitan area
export const BARRIO_GEO_ENTRIES = [
  // A Coruña ciudad
  {
    pattern: /\b(?:xux[aá]n|parque ofim[aá]tico|ofim[aá]tico)\b/i,
    lat: 43.3415,
    lng: -8.4042,
    municipality: 'A Coruña',
    barrio: 'Xuxán',
  },
  {
    pattern: /\b(?:someso|torres de someso|expocoruña|coliseum)\b/i,
    lat: 43.3412,
    lng: -8.4168,
    municipality: 'A Coruña',
    barrio: 'Someso',
  },
  {
    pattern: /\b(?:san pedro de visma|visma|loureiro|camiño do pinar)\b/i,
    lat: 43.3645,
    lng: -8.4312,
    municipality: 'A Coruña',
    barrio: 'San Pedro de Visma',
  },
  {
    pattern: /\b(?:novo mesoiro|nuevo mesoiro)\b/i,
    lat: 43.3298,
    lng: -8.4237,
    municipality: 'A Coruña',
    barrio: 'Novo Mesoiro',
  },
  {
    pattern: /\b(?:mesoiro)\b/i,
    lat: 43.3255,
    lng: -8.4278,
    municipality: 'A Coruña',
    barrio: 'Mesoiro',
  },
  {
    pattern: /\b(?:matogrande|enrique mariñas)\b/i,
    lat: 43.3442,
    lng: -8.4005,
    municipality: 'A Coruña',
    barrio: 'Matogrande',
  },
  {
    pattern: /\b(?:los rosales|as rosas|manuel murgu[ií]a)\b/i,
    lat: 43.3718,
    lng: -8.4325,
    municipality: 'A Coruña',
    barrio: 'Los Rosales',
  },
  {
    pattern: /\b(?:cuatro caminos|catro cami[ñn]os|f[aá]brica de tabacos|tabacos)\b/i,
    lat: 43.3562,
    lng: -8.4034,
    municipality: 'A Coruña',
    barrio: 'Cuatro Caminos',
  },
  {
    pattern: /\b(?:monte alto|zalaeta|orillamar|santo tom[aá]s|torre de h[eé]rcules|as lagoas)\b/i,
    lat: 43.3812,
    lng: -8.4011,
    municipality: 'A Coruña',
    barrio: 'Monte Alto',
  },
  {
    pattern: /\b(?:riazor|paseo de ronda|ciudad jard[ií]n)\b/i,
    lat: 43.3688,
    lng: -8.4172,
    municipality: 'A Coruña',
    barrio: 'Riazor',
  },
  {
    pattern: /\b(?:ciudad vieja|cidade vella|mar[ií]a pita|parrote|maestranza|barrio hist[oó]rico)\b/i,
    lat: 43.3695,
    lng: -8.3912,
    municipality: 'A Coruña',
    barrio: 'Ciudad Vieja',
  },
  {
    pattern: /\b(?:ensanche|cantones|obelisco|plaza de pontevedra|plaza de lugo|san andr[eé]s)\b/i,
    lat: 43.3672,
    lng: -8.4068,
    municipality: 'A Coruña',
    barrio: 'Ensanche',
  },
  {
    pattern: /\b(?:eir[ií]s|parque de eir[ií]s|santa gema|casablanca|chuac)\b/i,
    lat: 43.3421,
    lng: -8.3892,
    municipality: 'A Coruña',
    barrio: 'Eirís',
  },
  {
    pattern: /\b(?:monelos|barrio de las flores|barrio das flores|elvi[ñn]a)\b/i,
    lat: 43.3495,
    lng: -8.4015,
    municipality: 'A Coruña',
    barrio: 'Monelos',
  },
  {
    pattern: /\b(?:parque de oza|oza|os castros|gaiteira|a gaiteira|as xubias|san diego)\b/i,
    lat: 43.3532,
    lng: -8.3941,
    municipality: 'A Coruña',
    barrio: 'Oza / Os Castros',
  },
  {
    pattern: /\b(?:castrill[oó]n|o castrill[oó]n)\b/i,
    lat: 43.3498,
    lng: -8.3972,
    municipality: 'A Coruña',
    barrio: 'Castrillón',
  },
  {
    pattern: /\b(?:ventorrillo|agra do orz[aá]n|sagrada familia|laba[ñn]ou)\b/i,
    lat: 43.3601,
    lng: -8.4198,
    municipality: 'A Coruña',
    barrio: 'Ventorrillo / Agra',
  },
  {
    pattern: /\b(?:palavea|santa xema|fontenova)\b/i,
    lat: 43.3308,
    lng: -8.4002,
    municipality: 'A Coruña',
    barrio: 'Palavea',
  },
  {
    pattern: /\b(?:zapateira|a zapateira|la zapateira)\b/i,
    lat: 43.3235,
    lng: -8.4102,
    municipality: 'A Coruña',
    barrio: 'A Zapateira',
  },
  {
    pattern: /\b(?:fe[aá]ns|uxes)\b/i,
    lat: 43.3195,
    lng: -8.4348,
    municipality: 'A Coruña',
    barrio: 'Feáns',
  },
  {
    pattern: /\b(?:pocomaco|san crist[oó]bal das vi[ñn]as|martinete)\b/i,
    lat: 43.3385,
    lng: -8.4315,
    municipality: 'A Coruña',
    barrio: 'Pocomaco',
  },

  // Oleiros
  {
    pattern: /\b(?:perillo|santa cristina|r[uú]a xuncal)\b/i,
    lat: 43.3428,
    lng: -8.3692,
    municipality: 'Oleiros',
    barrio: 'Perillo',
  },
  {
    pattern: /\b(?:santa cruz|li[aá]ns|castelo de santa cruz)\b/i,
    lat: 43.3482,
    lng: -8.3512,
    municipality: 'Oleiros',
    barrio: 'Santa Cruz',
  },
  {
    pattern: /\b(?:bastiagueiro|as galeras)\b/i,
    lat: 43.3458,
    lng: -8.3618,
    municipality: 'Oleiros',
    barrio: 'Bastiagueiro',
  },
  {
    pattern: /\b(?:mera|serantes|canabal|espi[ñn]eiro)\b/i,
    lat: 43.3792,
    lng: -8.3345,
    municipality: 'Oleiros',
    barrio: 'Mera',
  },
  {
    pattern: /\b(?:montrove|o carballo)\b/i,
    lat: 43.3365,
    lng: -8.3621,
    municipality: 'Oleiros',
    barrio: 'Montrove',
  },
  {
    pattern: /\b(?:i[ñn][aá]s)\b/i,
    lat: 43.3315,
    lng: -8.3325,
    municipality: 'Oleiros',
    barrio: 'Iñás',
  },
  {
    pattern: /\b(?:nos|san pedro de nos|o seixo)\b/i,
    lat: 43.3312,
    lng: -8.3518,
    municipality: 'Oleiros',
    barrio: 'Nos',
  },
  {
    pattern: /\b(?:dorneda|arillo|canide)\b/i,
    lat: 43.3521,
    lng: -8.3312,
    municipality: 'Oleiros',
    barrio: 'Dorneda',
  },
  {
    pattern: /\b(?:lorb[eé]|dexo)\b/i,
    lat: 43.3855,
    lng: -8.3092,
    municipality: 'Oleiros',
    barrio: 'Lorbé',
  },
  {
    pattern: /\b(?:xaz|campo de golf de xaz)\b/i,
    lat: 43.3412,
    lng: -8.3385,
    municipality: 'Oleiros',
    barrio: 'Xaz',
  },

  // Culleredo
  {
    pattern: /\b(?:o burgo|el burgo|r[ií]a do burgo)\b/i,
    lat: 43.3208,
    lng: -8.3628,
    municipality: 'Culleredo',
    barrio: 'O Burgo',
  },
  {
    pattern: /\b(?:o temple|el temple|ponte do pasaxe)\b/i,
    lat: 43.3242,
    lng: -8.3592,
    municipality: 'Culleredo',
    barrio: 'O Temple',
  },
  {
    pattern: /\b(?:acea de ama|rutis)\b/i,
    lat: 43.3162,
    lng: -8.3685,
    municipality: 'Culleredo',
    barrio: 'Acea de Ama',
  },
  {
    pattern: /\b(?:vilaboa|alvedro)\b/i,
    lat: 43.3112,
    lng: -8.3795,
    municipality: 'Culleredo',
    barrio: 'Vilaboa',
  },
  {
    pattern: /\b(?:port[aá]dego|o port[aá]dego|cordeda)\b/i,
    lat: 43.3288,
    lng: -8.3742,
    municipality: 'Culleredo',
    barrio: 'Portádego',
  },
  {
    pattern: /\b(?:almeiras|choeira)\b/i,
    lat: 43.3032,
    lng: -8.3615,
    municipality: 'Culleredo',
    barrio: 'Almeiras',
  },
  {
    pattern: /\b(?:tarr[ií]o)\b/i,
    lat: 43.2882,
    lng: -8.3892,
    municipality: 'Culleredo',
    barrio: 'Tarrío',
  },
  {
    pattern: /\b(?:celas|ledo[ñn]o)\b/i,
    lat: 43.2655,
    lng: -8.3982,
    municipality: 'Culleredo',
    barrio: 'Celas',
  },

  // Arteixo
  {
    pattern: /\b(?:meicende|nosti[aá]n)\b/i,
    lat: 43.3452,
    lng: -8.4485,
    municipality: 'Arteixo',
    barrio: 'Meicende',
  },
  {
    pattern: /\b(?:pastoriza)\b/i,
    lat: 43.3362,
    lng: -8.4612,
    municipality: 'Arteixo',
    barrio: 'Pastoriza',
  },
  {
    pattern: /\b(?:vilarrod[ií]s)\b/i,
    lat: 43.3225,
    lng: -8.4792,
    municipality: 'Arteixo',
    barrio: 'Vilarrodís',
  },
  {
    pattern: /\b(?:sab[oó]n)\b/i,
    lat: 43.3155,
    lng: -8.5142,
    municipality: 'Arteixo',
    barrio: 'Sabón',
  },
  {
    pattern: /\b(?:oseiro|ra[ñn]obre)\b/i,
    lat: 43.3182,
    lng: -8.4985,
    municipality: 'Arteixo',
    barrio: 'Oseiro',
  },
  {
    pattern: /\b(?:barra[ñn][aá]n|suevos|sorrizo|cham[ií]n)\b/i,
    lat: 43.3105,
    lng: -8.5412,
    municipality: 'Arteixo',
    barrio: 'Barrañán',
  },

  // Cambre
  {
    pattern: /\b(?:a barcala|la barcala)\b/i,
    lat: 43.3142,
    lng: -8.3538,
    municipality: 'Cambre',
    barrio: 'A Barcala',
  },
  {
    pattern: /\b(?:sigr[aá]s)\b/i,
    lat: 43.2842,
    lng: -8.3615,
    municipality: 'Cambre',
    barrio: 'Sigrás',
  },
  {
    pattern: /\b(?:cecebre|encoro de cecebre)\b/i,
    lat: 43.2885,
    lng: -8.3185,
    municipality: 'Cambre',
    barrio: 'Cecebre',
  },

  // Sada
  {
    pattern: /\b(?:font[aá]n)\b/i,
    lat: 43.3582,
    lng: -8.2492,
    municipality: 'Sada',
    barrio: 'Fontán',
  },
  {
    pattern: /\b(?:carnoedo|veigue|taib[oó])\b/i,
    lat: 43.3752,
    lng: -8.2612,
    municipality: 'Sada',
    barrio: 'Carnoedo',
  },
  {
    pattern: /\b(?:so[ñn]eiro|osedo|mosteir[oó]n)\b/i,
    lat: 43.3392,
    lng: -8.2782,
    municipality: 'Sada',
    barrio: 'Soñeiro',
  },

  // Bergondo
  {
    pattern: /\b(?:gu[ií]samo)\b/i,
    lat: 43.3082,
    lng: -8.2592,
    municipality: 'Bergondo',
    barrio: 'Guísamo',
  },
  {
    pattern: /\b(?:gandar[ií]o|ouces)\b/i,
    lat: 43.3325,
    lng: -8.2215,
    municipality: 'Bergondo',
    barrio: 'Gandarío',
  },
];

// Municipality centroids
export const MUNICIPALITY_GEO_ENTRIES = [
  {
    pattern: /\b(?:a coru[ñn]a|la coru[ñn]a|coru[ñn]a)\b/i,
    lat: 43.3623,
    lng: -8.4115,
    municipality: 'A Coruña',
  },
  {
    pattern: /\b(?:oleiros)\b/i,
    lat: 43.3331,
    lng: -8.3175,
    municipality: 'Oleiros',
  },
  {
    pattern: /\b(?:culleredo)\b/i,
    lat: 43.3150,
    lng: -8.3700,
    municipality: 'Culleredo',
  },
  {
    pattern: /\b(?:arteixo)\b/i,
    lat: 43.3045,
    lng: -8.5065,
    municipality: 'Arteixo',
  },
  {
    pattern: /\b(?:cambre)\b/i,
    lat: 43.2925,
    lng: -8.3442,
    municipality: 'Cambre',
  },
  {
    pattern: /\b(?:sada)\b/i,
    lat: 43.3512,
    lng: -8.2542,
    municipality: 'Sada',
  },
  {
    pattern: /\b(?:bergondo)\b/i,
    lat: 43.3195,
    lng: -8.2325,
    municipality: 'Bergondo',
  },
  {
    pattern: /\b(?:carral)\b/i,
    lat: 43.2295,
    lng: -8.3542,
    municipality: 'Carral',
  },
  {
    pattern: /\b(?:abegondo)\b/i,
    lat: 43.2275,
    lng: -8.2882,
    municipality: 'Abegondo',
  },
];

export const MUNI_CENTROIDS = {
  'A Coruña': { lat: 43.3623, lng: -8.4115 },
  'Oleiros': { lat: 43.3331, lng: -8.3175 },
  'Culleredo': { lat: 43.3150, lng: -8.3700 },
  'Arteixo': { lat: 43.3045, lng: -8.5065 },
  'Cambre': { lat: 43.2925, lng: -8.3442 },
  'Sada': { lat: 43.3512, lng: -8.2542 },
  'Bergondo': { lat: 43.3195, lng: -8.2325 },
  'Carral': { lat: 43.2295, lng: -8.3542 },
  'Abegondo': { lat: 43.2275, lng: -8.2882 },
};

export const PRECISION_GEO_ENTRIES = [
  // ── XUXÁN (Parque Ofimático) Micro-Sectors & Streets ──
  {
    pattern: /\b(?:r[uú]a\s+matilde\s+landa|matilde\s+landa)\b/i,
    lat: 43.3418, lng: -8.4032, municipality: 'A Coruña', barrio: 'Xuxán', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:r[uú]a\s+isaac\s+d[ií]az\s+pardo|d[ií]az\s+pardo)\b/i,
    lat: 43.3426, lng: -8.4045, municipality: 'A Coruña', barrio: 'Xuxán', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:r[uú]a\s+lu[ií]s\s+seoane|lu[ií]s\s+seoane)\b/i,
    lat: 43.3409, lng: -8.4021, municipality: 'A Coruña', barrio: 'Xuxán', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:r[uú]a\s+d[aá]maso\s+alonso|d[aá]maso\s+alonso)\b/i,
    lat: 43.3431, lng: -8.4052, municipality: 'A Coruña', barrio: 'Xuxán', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:parcela\s+z[- ]?1[123]|parcela\s+z[- ]?2[037])\b/i,
    lat: 43.3420, lng: -8.4038, municipality: 'A Coruña', barrio: 'Xuxán', geoPrecision: 'parcela'
  },

  // ── SOMESO & EXPOCORUÑA ──
  {
    pattern: /\b(?:antonio\s+ferrandis|chanquete|torres\s+de\s+someso|torre\s+someso)\b/i,
    lat: 43.3418, lng: -8.4155, municipality: 'A Coruña', barrio: 'Someso', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:raimundo\s+ib[aá][ñn]ez|campus\s+de\s+elvi[ñn]a\s+acceso)\b/i,
    lat: 43.3406, lng: -8.4172, municipality: 'A Coruña', barrio: 'Someso', geoPrecision: 'calle'
  },

  // ── SAN PEDRO DE VISMA ──
  {
    pattern: /\b(?:cami[ñn]o\s+do\s+pinar|cami[ñn]o\s+de\s+pinar)\b/i,
    lat: 43.3638, lng: -8.4325, municipality: 'A Coruña', barrio: 'San Pedro de Visma', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:r[uú]a\s+loureiro|loureiro\s+visma)\b/i,
    lat: 43.3655, lng: -8.4298, municipality: 'A Coruña', barrio: 'San Pedro de Visma', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:pol[ií]gono\s+(?:de\s+)?visma|reparcelaci[oó]n\s+visma)\b/i,
    lat: 43.3645, lng: -8.4312, municipality: 'A Coruña', barrio: 'San Pedro de Visma', geoPrecision: 'poligono'
  },

  // ── OLEIROS: AS GALERAS, SANTA CRUZ, BASTIAGUEIRO ──
  {
    pattern: /\b(?:as\s+galeras|urbanizaci[oó]n\s+as\s+galeras|r[uú]a\s+das\s+galeras)\b/i,
    lat: 43.3465, lng: -8.3630, municipality: 'Oleiros', barrio: 'Bastiagueiro / As Galeras', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:porto\s+de\s+santa\s+cruz|paseo\s+mar[ií]timo\s+santa\s+cruz)\b/i,
    lat: 43.3490, lng: -8.3530, municipality: 'Oleiros', barrio: 'Santa Cruz', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:urbanizaci[oó]n\s+dos\s+regos|dos\s+regos)\b/i,
    lat: 43.3440, lng: -8.3450, municipality: 'Oleiros', barrio: 'Liáns', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:canide|arillo\s+canide)\b/i,
    lat: 43.3550, lng: -8.3360, municipality: 'Oleiros', barrio: 'Dorneda', geoPrecision: 'calle'
  },

  // ── CULLEREDO: O BURGO & ACEA DE AMA ──
  {
    pattern: /\b(?:paseo\s+mar[ií]timo\s+o\s+burgo|r[uú]a\s+ribeiro)\b/i,
    lat: 43.3215, lng: -8.3615, municipality: 'Culleredo', barrio: 'O Burgo', geoPrecision: 'calle'
  },
  {
    pattern: /\b(?:complexo\s+deportivo\s+acea\s+de\s+ama|avenida\s+de\s+rutis)\b/i,
    lat: 43.3168, lng: -8.3690, municipality: 'Culleredo', barrio: 'Acea de Ama', geoPrecision: 'calle'
  }
];

/**
 * Resolves a text string into geographic coordinates, municipality, and barrio.
 *
 * @param {string} text - Title, description, or location string
 * @param {string|null} fallbackMunicipality - Fallback municipality if known
 * @returns {object|null} Geocoding result
 */
export function resolveGeoLocation(text, fallbackMunicipality = null) {
  if (!text) {
    if (fallbackMunicipality && MUNI_CENTROIDS[fallbackMunicipality]) {
      const { lat, lng } = MUNI_CENTROIDS[fallbackMunicipality];
      return {
        lat,
        lng,
        municipality: fallbackMunicipality,
        barrio: null,
        geoPrecision: 'fallback',
      };
    }
    return null;
  }

  const raw = String(text);

  // 1. Street and Micro-Sector precision
  for (const entry of PRECISION_GEO_ENTRIES) {
    if (entry.pattern.test(raw)) {
      return {
        lat: entry.lat,
        lng: entry.lng,
        municipality: entry.municipality,
        barrio: entry.barrio,
        geoPrecision: entry.geoPrecision,
      };
    }
  }

  // 2. Barrio level match
  for (const entry of BARRIO_GEO_ENTRIES) {
    if (entry.pattern.test(raw)) {
      return {
        lat: entry.lat,
        lng: entry.lng,
        municipality: entry.municipality,
        barrio: entry.barrio,
        geoPrecision: 'barrio',
      };
    }
  }

  // 3. Municipality level match
  for (const entry of MUNICIPALITY_GEO_ENTRIES) {
    if (entry.pattern.test(raw)) {
      return {
        lat: entry.lat,
        lng: entry.lng,
        municipality: entry.municipality,
        barrio: null,
        geoPrecision: 'municipio',
      };
    }
  }

  // 4. Fallback
  if (fallbackMunicipality && MUNI_CENTROIDS[fallbackMunicipality]) {
    const { lat, lng } = MUNI_CENTROIDS[fallbackMunicipality];
    return {
      lat,
      lng,
      municipality: fallbackMunicipality,
      barrio: null,
      geoPrecision: 'fallback',
    };
  }

  return null;
}
