import { config, AREA_LABELS } from './config.mjs';
import { statusLabels, statusDescription } from './statuses.mjs';

const COMMERCIAL_STATUS = [...statusLabels(), null];

const HOUSING_SCHEMA = {
  type: 'object',
  properties: {
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
    estado: {
      type: ['string', 'null'],
      enum: COMMERCIAL_STATUS,
      description: 'Estado real de comercialización deducido del texto. null si el texto no da pistas.'
    },
    nombrePromocion: {
      type: ['string', 'null'],
      description: 'Nombre propio del proyecto/edificio/promoción principal (ej. "Mirador do Ézaro"), no el titular de la noticia, y nunca de otro proyecto solo mencionado de pasada. null si no se menciona un nombre propio del proyecto principal.'
    }
  },
  required: [
    'precioMin',
    'precioMax',
    'habitacionesMin',
    'banosMin',
    'promotora',
    'totalViviendas',
    'garaje',
    'trastero',
    'terraza',
    'estado',
    'nombrePromocion'
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
  if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
  const content = (await response.json()).choices?.[0]?.message?.content;
  return content ? JSON.parse(content) : null;
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
    precioMin: null,
    precioMax: null,
    habitacionesMin: null,
    banosMin: null,
    promotora: null,
    totalViviendas: null,
    garaje: null,
    trastero: null,
    terraza: null,
    estado: null,
    nombrePromocion: null,
  };

  const systemPrompt = `Eres un asistente experto en el sector inmobiliario español. Tu tarea es extraer información estructurada a partir del título y el resumen de una noticia sobre promociones de vivienda, cooperativas o parcelas de suelo residencial en España.
Rellena cada uno de los campos requeridos en el objeto JSON de salida. Si un campo no se menciona en la noticia, asígnale el valor null.
Para "estado", deduce el estado real de comercialización a partir del texto (no asumas "Comercialización" por defecto): ${statusDescription()}. Si el texto no da ninguna pista, deja null.
"nombrePromocion" es el nombre propio del proyecto principal del que trata la noticia (ej. "Mirador do Ézaro"), NUNCA de otros proyectos o promotoras que la noticia solo mencione de pasada como contexto o comparación (habitual en prensa inmobiliaria: "en la misma zona destacan también..."). Si tienes dudas de si un nombre pertenece al proyecto principal de esta noticia, déjalo fuera.`;

  const userPrompt = `Noticia para analizar:
Título: ${title}
Resumen: ${summary}`;

  try {
    const parsed = await askLLM('extract_housing_details', HOUSING_SCHEMA, systemPrompt, userPrompt, 0.1);
    return parsed ?? defaultData;
  } catch (error) {
    console.warn(`[llm] Fallo al extraer datos con LLM (Structured Output): ${error.message}`);
    // Marca el fallo como transitorio (cuota, red, etc.) para que el pipeline NO cachee este
    // ítem como "ya procesado": debe reintentarse en la próxima corrida, no quedarse con nulls.
    return { ...defaultData, llmCallFailed: true };
  }
}

/**
 * From a set of web search results, extracts the names of housing cooperative
 * managers / developers that actually operate in the A Coruña area, so the
 * directory can discover new gestoras on its own instead of relying on a
 * hardcoded seed list. Grounded on the search results, no invented names.
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
    return parsed?.nombres ?? [];
  } catch (error) {
    console.warn(`[llm] Fallo al descubrir gestoras: ${error.message}`);
    return [];
  }
}

/**
 * Given search results for a company name, asks the LLM which one (if any) is
 * actually that company's own official site — search ranking can surface a
 * different, unrelated company in the same sector (e.g. searching "Nozar"
 * returning a competitor's site), so a plain substring match on the name is
 * not reliable enough.
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
 * Extracts real contact data for a gestora/promotora from actually-scraped page
 * content (grounded), instead of asking the model to recall it from memory.
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
      address: { type: 'string', description: 'Dirección física literal del texto. Cadena vacía si no aparece.' },
      description: { type: 'string', description: 'Síntesis de 2-3 frases de lo que dice el texto sobre la empresa. Cadena vacía si no hay suficiente información.' }
    },
    required: ['website', 'phone', 'email', 'address', 'description'],
    additionalProperties: false
  };

  try {
    return await askLLM('extract_gestora_contact', schema, systemPrompt, userPrompt);
  } catch (error) {
    console.warn(`[llm] Fallo al extraer contacto real para ${name}: ${error.message}`);
    return null;
  }
}

/**
 * Extracts the list of housing developments/cooperatives actually listed on a
 * gestora's own website (grounded), so the directory reflects the company's
 * real current catalog instead of only what a news article happened to cover.
 *
 * @param {string} name - Developer/Gestora name
 * @param {string} pageMarkdown - Scraped markdown of the gestora's site (or a projects page)
 * @returns {Promise<Array<{nombre: string, estado: string|null, location: string|null, totalViviendas: number|null, entregaEstimada: string|null, buscaSocios: boolean|null, aportacionInicial: number|null}>>}
 */
export async function extractPromotionsFromText(name, pageMarkdown) {
  const systemPrompt = `Eres un asistente que extrae, de una página web ya rastreada de la empresa española '${name}', la lista de promociones/proyectos/cooperativas de vivienda que aparecen mencionados con nombre propio.
Usa ÚNICAMENTE lo que aparece literalmente en el texto. No inventes proyectos ni completes con conocimiento propio. Si el texto no lista ninguna promoción con nombre propio, devuelve una lista vacía.
No incluyas viviendas individuales sueltas en venta (pisos concretos de reventa), solo promociones/edificios/cooperativas con nombre de proyecto.
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
                    location: { type: ['string', 'null'], description: 'Ubicación literal del texto. null si no aparece.' },
                    totalViviendas: { type: ['number', 'null'], description: 'Total de viviendas si aparece en el texto. null si no aparece.' },
                    entregaEstimada: { type: ['string', 'null'], description: 'Fecha o año estimado de entrega tal como aparece ("2027", "primer trimestre de 2026"). null si no aparece.' },
                    buscaSocios: { type: ['boolean', 'null'], description: 'true si el texto indica captación abierta de socios/compradores, false si completa/adjudicada, null si no se dice.' },
                    aportacionInicial: { type: ['number', 'null'], description: 'Aportación inicial en euros si aparece en el texto. null si no aparece.' }
                  },
                  required: ['nombre', 'estado', 'location', 'totalViviendas', 'entregaEstimada', 'buscaSocios', 'aportacionInicial'],
          additionalProperties: false
        }
      }
    },
    required: ['promociones'],
    additionalProperties: false
  };

  try {
    const parsed = await askLLM('extract_gestora_catalog', schema, systemPrompt, userPrompt);
    return parsed?.promociones ?? [];
  } catch (error) {
    console.warn(`[llm] Fallo al extraer catálogo de promociones para ${name}: ${error.message}`);
    return [];
  }
}
