import { config, AREA_LABELS } from './config.mjs';
import { classifyPromotionLocation, resolveMunicipality } from './municipios.mjs';
import { hasStatusEvidence, statusLabels, statusDescription } from './statuses.mjs';

const COMMERCIAL_STATUS = [...statusLabels(), null];
const PROMOTION_TYPES = ['Cooperativa', 'Obra Nueva', 'Vivienda protegida', 'Suelo', null];

const HOUSING_SCHEMA = {
  type: 'object',
  properties: {
    nombrePromocion: {
      type: ['string', 'null'],
      description: 'Nombre propio del proyecto/edificio/promoción principal (ej. "Mirador do Ézaro"), no el titular de la noticia. null si no se menciona.'
    },
    tipoPromocion: {
      type: ['string', 'null'],
      enum: PROMOTION_TYPES,
      description: 'Categoría principal: "Cooperativa", "Obra Nueva", "Vivienda protegida" o "Suelo". null si no se puede clasificar con certeza.'
    },
    municipio: {
      type: ['string', 'null'],
      description: 'Municipio del área metropolitana (A Coruña, Oleiros, Culleredo, Arteixo, Cambre, Sada, Bergondo, Carral, Abegondo). null si no se menciona.'
    },
    barrio: {
      type: ['string', 'null'],
      description: 'Barrio, polígono o zona específica (ej. "Xuxán", "Someso", "San Pedro de Visma", "Los Rosales", "Matogrande", "Perillo", "Santa Cruz", "O Burgo"). null si no se menciona.'
    },
    direccion: {
      type: ['string', 'null'],
      description: 'Calle o dirección postal si aparece textualmente. null si no se menciona.'
    },
    precioMin: {
      type: ['number', 'null'],
      description: 'Precio mínimo de la promoción en euros. null si no se menciona.'
    },
    precioMax: {
      type: ['number', 'null'],
      description: 'Precio máximo de la promoción en euros. null si no se menciona.'
    },
    habitacionesMin: {
      type: ['number', 'null'],
      description: 'Número mínimo de habitaciones de los pisos. null si no se menciona.'
    },
    banosMin: {
      type: ['number', 'null'],
      description: 'Número mínimo de baños de los pisos. null si no se menciona.'
    },
    promotora: {
      type: ['string', 'null'],
      description: 'Nombre de la promotora, gestora de cooperativa o constructora. null si no se menciona.'
    },
    totalViviendas: {
      type: ['number', 'null'],
      description: 'Número total de viviendas de la promoción. null si no se menciona.'
    },
    entregaEstimada: {
      type: ['string', 'null'],
      description: 'Fecha o año estimado de entrega tal como aparece ("2026", "2T 2027"). null si no se menciona.'
    },
    garaje: {
      type: ['boolean', 'null'],
      description: 'true si se incluye garaje/aparcamiento, false si explícitamente se dice que no tiene, null si no se menciona.'
    },
    trastero: {
      type: ['boolean', 'null'],
      description: 'true si se incluye trastero/bodega, false si explícitamente se dice que no tiene, null si no se menciona.'
    },
    terraza: {
      type: ['boolean', 'null'],
      description: 'true si se incluye terraza, balcón, porche o jardín, false si explícitamente se dice que no tiene, null si no se menciona.'
    },
    piscina: {
      type: ['boolean', 'null'],
      description: 'true si incluye piscina comunitaria/privada, false si no, null si no se menciona.'
    },
    ascensor: {
      type: ['boolean', 'null'],
      description: 'true si el edificio cuenta con ascensor, false si no, null si no se menciona.'
    },
    estado: {
      type: ['string', 'null'],
      enum: COMMERCIAL_STATUS,
      description: 'Estado real de comercialización deducido del texto. null si el texto no da pistas.'
    }
  },
  required: [
    'nombrePromocion',
    'tipoPromocion',
    'municipio',
    'barrio',
    'direccion',
    'precioMin',
    'precioMax',
    'habitacionesMin',
    'banosMin',
    'promotora',
    'totalViviendas',
    'entregaEstimada',
    'garaje',
    'trastero',
    'terraza',
    'piscina',
    'ascensor',
    'estado'
  ],
  additionalProperties: false
};

/**
 * Single POST to an OpenAI-compatible /chat/completions endpoint (OpenRouter by
 * default) with Strict Structured Outputs. Returns the parsed JSON, or null when
 * there is no API key configured or the model returned no content. Throws on
 * HTTP/network errors so callers can decide whether to retry.
 */
async function askLLM(name, schema, systemPrompt, userPrompt, temperature = 0) {
  if (!config.llm.apiKey) return null;
  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      response_format: {
        type: 'json_schema',
        json_schema: { name, strict: true, schema },
      },
    }),
  });
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const content = (await response.json()).choices?.[0]?.message?.content;
  return content ? JSON.parse(content) : null;
}

const normalizeEvidence = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').trim();

function observedNumbers(source) {
  return [...String(source || '').matchAll(/\b\d[\d.,]*\b/g)].map(([raw]) => {
    const cleaned = raw.replace(/\s/g, '');
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(cleaned)) return Number(cleaned.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned.replace(/,/g, ''));
    return Number(cleaned.replace(',', '.'));
  }).filter(Number.isFinite);
}

const NUMBER_WORDS = new Map([
  ['uno', 1], ['una', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5],
  ['seis', 6], ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10],
  ['once', 11], ['doce', 12], ['trece', 13], ['catorce', 14], ['quince', 15],
]);

function numericEvidenceWindows(value, source) {
  if (!Number.isFinite(value)) return [];
  const normalized = normalizeEvidence(source);
  const windows = [];
  for (const match of normalized.matchAll(/\b\d[\d.,]*\b/g)) {
    const seen = observedNumbers(match[0])[0];
    if (Math.abs(seen - value) < 0.01) {
      const start = Math.max(0, match.index - 80);
      windows.push(`${normalized.slice(start, match.index)} # ${normalized.slice(match.index + match[0].length, match.index + match[0].length + 80)}`);
    }
  }
  for (const [word, seen] of NUMBER_WORDS) {
    if (seen !== value) continue;
    for (const match of normalized.matchAll(new RegExp(`\\b${word}\\b`, 'g'))) {
      const start = Math.max(0, match.index - 80);
      windows.push(`${normalized.slice(start, match.index)} # ${normalized.slice(match.index + word.length, match.index + word.length + 80)}`);
    }
  }
  return windows;
}

const fieldNumber = (value, min, max, source, predicate) => Number.isFinite(value)
  && value >= min && value <= max
  && numericEvidenceWindows(value, source).some(predicate) ? value : null;

export function isGroundedEntityName(value, source, kind = 'company') {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 100 || clean.split(/\s+/).length > 10) return null;
  if (!normalizeEvidence(source).includes(normalizeEvidence(clean))) return null;
  if (/^(?:el pasado|de las|de los|la empresa del|promoci[oó]n en|residencial para|reactiva|construir[aá]|promueve|desarrolla|gestiona)\b/i.test(clean)) return null;
  if (/\s+-\s+(?:la|el)\s+(?:opini[oó]n|espa[nñ]ol|voz|ideal)\b/i.test(clean)) return null;
  if (kind === 'promotion' && /^(?:cooperativa (?:de la promoci[oó]n|de|en|para)\b|edificio de (?:\d+\s+)?(?:viviendas|pisos)\b|promoci[oó]n de obra nueva\b|promoci[oó]n residencial\s*$|promoci[oó]n en\b)/i.test(clean)) return null;
  return clean;
}

export function validateExtractedHousingData(parsed, title, summary) {
  const source = `${title}\n${summary}`;
  const normalizedSource = normalizeEvidence(source);
  const priceContext = (window) => /(?:€|euros?\b)/.test(window) && /\b(?:precio|precios|desde|a partir|cuesta|coste|importe|valor de venta)\b/.test(window);
  const roomContext = (window) => /#.{0,30}\b(?:dormitorios?|habitaciones?|hab\.)\b|\b(?:dormitorios?|habitaciones?)\b.{0,20}#/.test(window);
  const bathContext = (window) => /#.{0,20}\b(?:banos?|cuartos? de bano)\b|\b(?:banos?|cuartos? de bano)\b.{0,20}#/.test(window);
  const totalContext = (window) => /#\s*(?:nuevas?\s+)?(?:viviendas?|pisos?|unidades)\b/.test(window);
  const precioMin = fieldNumber(parsed.precioMin, 100000, 2_000_000, source, priceContext);
  const precioMax = fieldNumber(parsed.precioMax, 100000, 3_000_000, source, priceContext);
  const amenity = (value, positive, negative) => {
    const hasNegative = negative.test(normalizedSource);
    const positiveSource = normalizedSource.replace(negative, ' ');
    if (value === true) return !hasNegative && positive.test(positiveSource) ? true : null;
    if (value === false) return hasNegative ? false : null;
    return null;
  };
  let estado = parsed.estado && hasStatusEvidence(parsed.estado, source) ? parsed.estado : null;
  if (estado === 'Agotada/Vendida' && !/(?:viviendas|unidades|promocion).{0,60}(?:agotad|vendid)|(?:agotad|vendid).{0,60}(?:viviendas|unidades|promocion)|no quedan/i.test(normalizedSource)) estado = null;
  const validMunicipality = parsed.municipio ? (resolveMunicipality(parsed.municipio) || classifyPromotionLocation(parsed.municipio).municipality) : null;
  return {
    ...parsed,
    municipio: validMunicipality,
    precioMin,
    precioMax: precioMax && (!precioMin || precioMax >= precioMin) ? precioMax : null,
    habitacionesMin: fieldNumber(parsed.habitacionesMin, 1, 8, source, roomContext),
    banosMin: fieldNumber(parsed.banosMin, 1, 6, source, bathContext),
    totalViviendas: fieldNumber(parsed.totalViviendas, 2, 2000, source, totalContext),
    garaje: amenity(parsed.garaje, /\b(?:garaje|aparcamiento|parking)\b/i, /\bsin (?:garaje|aparcamiento|parking)\b/i),
    trastero: amenity(parsed.trastero, /\b(?:trastero|bodega)\b/i, /\bsin (?:trastero|bodega)\b/i),
    terraza: amenity(parsed.terraza, /\b(?:terraza|balcon|porche|jardin)\b/i, /\bsin (?:terraza|balcon|porche|jardin)\b/i),
    estado,
    promotora: isGroundedEntityName(parsed.promotora, source, 'company'),
    nombrePromocion: isGroundedEntityName(parsed.nombrePromocion, source, 'promotion'),
  };
}

/**
 * Infers municipality and barrio from text with LLM when regex/dictionary cannot resolve it.
 *
 * @param {string} text - Title, summary, or description
 * @returns {Promise<{municipio: string|null, barrio: string|null, direccion: string|null}>}
 */
export async function inferLocationWithLLM(text) {
  if (!config.llm.apiKey || !text) return { municipio: null, barrio: null, direccion: null };

  const systemPrompt = `Eres un asistente experto en geografía urbana del área metropolitana de A Coruña (España).
A partir del texto proporcionado sobre una promoción de vivienda o noticia inmobiliaria, identifica el municipio (${AREA_LABELS.join(', ')}) y, si es posible, el barrio o zona específica (ej. Xuxán, Someso, Visma, Los Rosales, Cuatro Caminos, Matogrande, Perillo, Santa Cruz, O Burgo).
Si el texto no se refiere al área metropolitana de A Coruña o no menciona ninguna ubicación, asigna null a los campos correspondientes.`;

  const userPrompt = `Texto a analizar:\n${text.slice(0, 2000)}`;

  const schema = {
    type: 'object',
    properties: {
      municipio: {
        type: ['string', 'null'],
        description: 'Nombre del municipio del área metropolitana de A Coruña, o null si no se menciona o está fuera del área.'
      },
      barrio: {
        type: ['string', 'null'],
        description: 'Nombre del barrio, polígono o zona específica, o null.'
      },
      direccion: {
        type: ['string', 'null'],
        description: 'Calle o dirección aproximada si aparece textualmente, o null.'
      }
    },
    required: ['municipio', 'barrio', 'direccion'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('infer_location', schema, systemPrompt, userPrompt, 0);
    if (!parsed) return { municipio: null, barrio: null, direccion: null };
    return {
      municipio: parsed.municipio ? (resolveMunicipality(parsed.municipio) || classifyPromotionLocation(parsed.municipio).municipality) : null,
      barrio: parsed.barrio || null,
      direccion: parsed.direccion || null,
    };
  } catch (error) {
    console.warn(`[llm] Fallo al inferir ubicación con LLM: ${error.message}`);
    return { municipio: null, barrio: null, direccion: null };
  }
}

/**
 * Extracts structured housing details from a news alert title and summary.
 *
 * @param {string} title - The news title
 * @param {string} summary - The news summary/snippet
 * @returns {Promise<Object>} The extracted fields (guaranteed to match the schema)
 */
export async function extractHousingData(title, summary) {
  const defaultData = {
    nombrePromocion: null,
    tipoPromocion: null,
    municipio: null,
    barrio: null,
    direccion: null,
    precioMin: null,
    precioMax: null,
    habitacionesMin: null,
    banosMin: null,
    promotora: null,
    totalViviendas: null,
    entregaEstimada: null,
    garaje: null,
    trastero: null,
    terraza: null,
    piscina: null,
    ascensor: null,
    estado: null,
  };

  const systemPrompt = `Eres un asistente experto en el sector inmobiliario del área metropolitana de A Coruña (España). Tu tarea es extraer información estructurada a partir del título y el resumen de una noticia sobre promociones de vivienda, cooperativas o suelo residencial.
Rellena cada uno de los campos requeridos en el objeto JSON de salida. Si un campo no se menciona en la noticia, asígnale el valor null.
Para "municipio", extrae el municipio correspondiente (${AREA_LABELS.join(', ')}).
Para "barrio", extrae el barrio, polígono o zona específica (ej. Xuxán, Someso, Visma, Los Rosales, Cuatro Caminos, Matogrande, Perillo, Santa Cruz, O Burgo).
Para "estado", deduce el estado real de comercialización a partir del texto: ${statusDescription()}. Si el texto no da ninguna pista, deja null.
"nombrePromocion" es el nombre propio del proyecto principal (ej. "Mirador do Ézaro"), nunca de otros proyectos mencionados de pasada.`;

  const userPrompt = `Noticia para analizar:
Título: ${title}
Resumen: ${summary}`;

  if (!config.llm.apiKey) return { ...defaultData, llmCallSkipped: true, llmCallFailed: false };

  try {
    const parsed = await askLLM('extract_housing_details', HOUSING_SCHEMA, systemPrompt, userPrompt, 0.1);
    return parsed ? validateExtractedHousingData(parsed, title, summary) : { ...defaultData, llmCallFailed: true };
  } catch (error) {
    console.warn(`[llm] Fallo al extraer datos con LLM (Structured Output): ${error.message}`);
    return { ...defaultData, llmCallFailed: true };
  }
}

/**
 * From a set of web search results, extracts the names of housing cooperative
 * managers / developers that actually operate in the A Coruña area.
 *
 * @param {Array<{url: string, title: string}>} results - Search results
 * @returns {Promise<string[]>} Company names found (may be empty)
 */
export async function discoverGestoraNames(results) {
  if (results.length === 0) return [];

  const systemPrompt = `Eres un asistente que, a partir de resultados de búsqueda web, extrae los nombres de gestoras de cooperativas de viviendas, promotoras o constructoras que operan en A Coruña o su área metropolitana.
Devuelve SOLO nombres de empresas reales que aparezcan en los resultados. No inventes nombres. Ignora portales inmobiliarios genéricos (Idealista, Fotocasa, etc.), medios de prensa y directorios. Si no hay ninguna empresa clara, devuelve lista vacía.`;

  const userPrompt = `Resultados de búsqueda:\n${results.map((r, i) => `${i}: ${r.title} — ${r.url}`).join('\n')}`;

  const schema = {
    type: 'object',
    properties: {
      nombres: {
        type: 'array',
        description: 'Nombres de empresas del sector que operan en A Coruña. Vacío si ninguno.',
        items: { type: 'string' }
      }
    },
    required: ['nombres'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('discover_gestoras', schema, systemPrompt, userPrompt);
    const evidence = results.map((result) => `${result.title} ${result.url}`).join('\n');
    return (parsed?.nombres ?? []).filter((candidate) => isGroundedEntityName(candidate, evidence, 'company'));
  } catch (error) {
    console.warn(`[llm] Fallo al descubrir gestoras: ${error.message}`);
    return [];
  }
}

/**
 * Given search results for a company name, asks the LLM which one is official site.
 *
 * @param {string} name - Developer/Gestora name being searched for
 * @param {Array<{url: string, title: string}>} results - Candidate search results
 * @returns {Promise<string|null>} The matching URL, or null if none is a confident match
 */
export async function pickOfficialWebsite(name, results) {
  if (results.length === 0) return null;

  const systemPrompt = `Eres un asistente que decide, entre varios resultados de búsqueda, cuál es la web oficial propia de la empresa española '${name}' (no un directorio de terceros, no una empresa distinta del mismo sector, no redes sociales salvo que sea el único canal oficial verificable). Si ninguno de los resultados es claramente la web propia de esa empresa, responde con indexMatch: -1.`;

  const userPrompt = `Resultados (índice: título — url):\n${results.map((r, i) => `${i}: ${r.title} — ${r.url}`).join('\n')}`;

  const schema = {
    type: 'object',
    properties: {
      indexMatch: { type: 'integer', description: `Índice (0 a ${results.length - 1}) del resultado que es la web oficial propia de la empresa, o -1 si ninguno lo es.` }
    },
    required: ['indexMatch'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('pick_official_website', schema, systemPrompt, userPrompt);
    return results[parsed?.indexMatch]?.url ?? null;
  } catch (error) {
    console.warn(`[llm] Fallo al elegir web oficial para ${name}: ${error.message}`);
    return null;
  }
}

/**
 * Extracts real contact data for a gestora/promotora from scraped page content.
 *
 * @param {string} name - Developer/Gestora name
 * @param {string} pageMarkdown - Scraped markdown of a page found for this company
 * @returns {Promise<Object|null>} Extracted contact fields, or null on failure
 */
export async function extractGestoraContactFromText(name, pageMarkdown) {
  const systemPrompt = `Eres un asistente que extrae datos de contacto reales de una empresa española del sector inmobiliario/cooperativas llamada '${name}' a partir del contenido de una página web ya rastreada.
Usa ÚNICAMENTE lo que aparece literalmente en el texto proporcionado. No inventes ni completes con conocimiento propio. Si un dato no aparece en el texto, devuélvelo como cadena vacía ''.`;

  const userPrompt = `Contenido de la página (markdown):\n${pageMarkdown.slice(0, 8000)}`;

  const schema = {
    type: 'object',
    properties: {
      website: { type: 'string', description: 'URL oficial de la empresa tal como aparece en el texto. Cadena vacía si no aparece.' },
      phone: { type: 'string', description: 'Teléfono de contacto literal del texto. Cadena vacía si no aparece.' },
      email: { type: 'string', description: 'Email de contacto literal del texto. Cadena vacía si no aparece.' },
      address: { type: 'string', description: 'Dirección física literal del texto. Cadena vacía si no aparece.' }
    },
    required: ['website', 'phone', 'email', 'address'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('extract_gestora_contact', schema, systemPrompt, userPrompt);
    if (!parsed) return null;
    const literal = (value) => value && normalizeEvidence(pageMarkdown).includes(normalizeEvidence(value)) ? value : '';
    return {
      website: literal(parsed.website),
      phone: literal(parsed.phone),
      email: literal(parsed.email),
      address: literal(parsed.address),
      description: '',
    };
  } catch (error) {
    console.warn(`[llm] Fallo al extraer contacto real para ${name}: ${error.message}`);
    return null;
  }
}

/**
 * Extracts the list of housing developments listed on a gestora website.
 *
 * @param {string} name - Developer/Gestora name
 * @param {string} pageMarkdown - Scraped markdown
 * @returns {Promise<Array<Object>>}
 */
export async function extractPromotionsFromText(name, pageMarkdown) {
  const systemPrompt = `Eres un asistente que extrae, de una página web ya rastreada de la empresa española '${name}', la lista de promociones/proyectos/cooperativas de vivienda que aparecen mencionados con nombre propio.
Usa ÚNICAMENTE lo que aparece literalmente en el texto. No inventes proyectos ni completes con conocimiento propio. Si el texto no lista ninguna promoción con nombre propio, devuelve una lista vacía.
No incluyas viviendas individuales sueltas en venta (pisos de segunda mano/reventa), solo promociones/edificios/cooperativas con nombre de proyecto.
"buscaSocios" es true solo si el texto indica activamente que la promoción está en captación de socios o compradores ("inscríbete", "plazo abierto", "únete a la cooperativa", "venta en curso"); false si dice que está completa/adjudicada; null si no se dice.
IMPORTANTE: esta empresa puede operar en toda España. Incluye SOLO promociones cuya ubicación esté en A Coruña ciudad o su área metropolitana inmediata (${AREA_LABELS.join(', ')}). Si la ubicación de una promoción no aparece o no es claramente una de esas zonas, NO la incluyas.`;

  const userPrompt = `Contenido de la página (markdown):\n${pageMarkdown.slice(0, 8000)}`;

  const schema = {
    type: 'object',
    properties: {
      promociones: {
        type: 'array',
        description: 'Promociones con nombre propio listadas literalmente en el texto. Vacío si no hay ninguna.',
        items: {
          type: 'object',
          properties: {
            nombre: { type: 'string', description: 'Nombre propio de la promoción tal como aparece en el texto' },
            estado: {
              type: ['string', 'null'],
              enum: COMMERCIAL_STATUS,
              description: 'Estado deducido literalmente del texto. null si no se indica.'
            },
            location: { type: ['string', 'null'], description: 'Ubicación literal del texto (municipio o barrio). null si no aparece.' },
            barrio: { type: ['string', 'null'], description: 'Barrio o zona específica si se menciona (ej. Xuxán, Someso, Visma, Perillo). null si no aparece.' },
            totalViviendas: { type: ['number', 'null'], description: 'Total de viviendas si aparece en el texto. null si no aparece.' },
            entregaEstimada: { type: ['string', 'null'], description: 'Fecha o año estimado de entrega tal como aparece ("2027", "primer trimestre de 2026"). null si no aparece.' },
            buscaSocios: { type: ['boolean', 'null'], description: 'true si el texto indica captación abierta de socios/compradores, false si completa/adjudicada, null si no se dice.' },
            aportacionInicial: { type: ['number', 'null'], description: 'Aportación inicial en euros si aparece en el texto. null si no aparece.' }
          },
          required: ['nombre', 'estado', 'location', 'barrio', 'totalViviendas', 'entregaEstimada', 'buscaSocios', 'aportacionInicial'],
          additionalProperties: false
        }
      }
    },
    required: ['promociones'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('extract_gestora_catalog', schema, systemPrompt, userPrompt);
    const normalize = (value) => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/\s+/g, ' ').trim();
    const haystack = normalize(pageMarkdown);

    // Divide de forma determinista por el siguiente nombre detectado. Así, la
    // ubicación o las cifras de una tarjeta no contaminan la anterior.
    const candidates = parsed?.promociones ?? [];
    const positions = candidates
      .map((promo) => ({ promo, index: haystack.indexOf(normalize(promo.nombre)) }))
      .filter(({ index }) => index >= 0)
      .sort((a, b) => a.index - b.index);

    return positions.flatMap(({ promo, index }, position) => {
      if (!promo.nombre || !promo.location) return [];
      if (!isGroundedEntityName(promo.nombre, pageMarkdown, 'promotion')) return [];
      if (classifyPromotionLocation(promo.location).scopeStatus !== 'in_scope') return [];
      const name = normalize(promo.nombre);
      const location = normalize(promo.location);
      const nextIndex = positions[position + 1]?.index ?? Math.min(haystack.length, index + name.length + 1500);
      const block = haystack.slice(Math.max(0, index - 250), nextIndex);
      const projectBlock = block.split(/\b(?:oficina|contacto|direccion social|sede)\s*:/i)[0];
      if (!projectBlock.includes(location)) return [];
      const literal = (value) => value && block.includes(normalize(value)) ? value : null;
      const catalogTotalContext = (window) => /#\s*(?:nuevas?\s+)?(?:viviendas?|pisos?|unidades)\b/.test(window);
      const contributionContext = (window) => /(?:€|euros?\b)/.test(window) && /\b(?:aportacion|entrada|desembolso inicial)\b/.test(window);
      return [{
        ...promo,
        estado: promo.estado && hasStatusEvidence(promo.estado, block) ? promo.estado : null,
        totalViviendas: fieldNumber(promo.totalViviendas, 2, 2000, projectBlock, catalogTotalContext),
        entregaEstimada: literal(promo.entregaEstimada),
        buscaSocios: promo.buscaSocios === true
          ? (/\b(?:inscribete|plazo abierto|unete|captacion|venta en curso|busca socios)\b/i.test(block) ? true : null)
          : promo.buscaSocios === false
            ? (/\b(?:completa|adjudicada|cerrada|sin plazas)\b/i.test(block) ? false : null)
            : null,
        aportacionInicial: fieldNumber(promo.aportacionInicial, 1000, 2_000_000, projectBlock, contributionContext),
      }];
    });
  } catch (error) {
    console.warn(`[llm] Fallo al extraer catálogo de promociones para ${name}: ${error.message}`);
    return [];
  }
}
