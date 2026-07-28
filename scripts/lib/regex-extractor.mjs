import { detectStatus } from './statuses.mjs';

/**
 * Regex-based housing data extractor.
 * Captures structured fields from Spanish real-estate text WITHOUT an LLM call.
 * Returns null for any field it cannot confidently match — the caller can then
 * fall back to the LLM for the remaining fields.
 *
 * Google Tech Lead principle: don't burn GPU on what a regex can solve.
 * This module handles ~80% of extraction cases at zero token cost.
 */

/**
 * @param {string} text — raw markdown or plain text (title + body)
 * @returns {object} extracted fields (all nullable); {llmNeeded: true} if regex
 *                   coverage was low and the caller should invoke the LLM.
 */
export function extractWithRegex(text) {
  // Título + inicio del contenido principal. Limitar la ventana evita capturar
  // cifras y estados de noticias relacionadas, menús o pies de página.
  const t = String(text || '').slice(0, 1800);

  const result = {
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

  // ── PRECIOS ──────────────────────────────────────────────────────────
  // "desde 180.000 €", "a partir de 195.000 euros", "entre 220.000 y 350.000 €",
  // "precios desde 165.000", "viviendas desde 180.000€"
  const precioDesde = t.match(/(?:desde|a partir de|precios? desde)\s*([\d.,]+)\s*(?:€|euros?)/i);
  if (precioDesde) {
    result.precioMin = parseNumber(precioDesde[1]);
  }

  const precioRango = t.match(/(?:entre|de)\s*([\d.,]+)\s*(?:y|a|-)\s*([\d.,]+)\s*(?:€|euros?)/i);
  if (precioRango) {
    result.precioMin = result.precioMin || parseNumber(precioRango[1]);
    result.precioMax = parseNumber(precioRango[2]);
  }

  // "hasta 350.000 €", "máximo 400.000"
  const precioMax = t.match(/(?:hasta|m[aá]ximo)\s*([\d.,]+)\s*(?:€|euros?)/i);
  if (precioMax && !result.precioMax) {
    result.precioMax = parseNumber(precioMax[1]);
  }

  // ── HABITACIONES ─────────────────────────────────────────────────────
  // "2 y 3 dormitorios", "de 1 a 4 habitaciones", "viviendas de 2, 3 y 4 dormitorios",
  // "pisos de 1, 2 y 3 habitaciones"
  const habs = t.match(/(?:de|con)\s*(\d)\s*(?:y|,|a|\s)\s*(\d)\s*(?:dormitorios|habitaciones|hab\.?)/i)
    || t.match(/(\d)\s*(?:y|,)\s*(\d)\s*(?:dormitorios|habitaciones)/i)
    || t.match(/(\d)\s*(?:dormitorios|habitaciones)/i);
  if (habs) {
    result.habitacionesMin = parseInt(habs[1], 10);
    if (habs[2]) {
      // second number is the max, but we store min
    }
  }

  // ── BAÑOS ────────────────────────────────────────────────────────────
  const banos = t.match(/(\d)\s*(?:baños|baños completos|cuartos de baño)/i);
  if (banos) {
    result.banosMin = parseInt(banos[1], 10);
  }

  // ── TOTAL VIVIENDAS ──────────────────────────────────────────────────
  // "241 viviendas", "32 nuevas viviendas", "100 viviendas", "promoción de 64 pisos"
  const numberWords = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20 };
  const totalViv = t.match(/(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte)\s*(?:nuevas?\s+)?(?:viviendas|pisos|unidades)/i);
  if (totalViv) {
    result.totalViviendas = /^\d+$/.test(totalViv[1])
      ? parseInt(totalViv[1], 10)
      : numberWords[totalViv[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  }

  // ── GARAJE ───────────────────────────────────────────────────────────
  if (/\b(?:con\s+)?garaje\b/i.test(t) && !/\bsin garaje\b/i.test(t)) {
    result.garaje = true;
  } else if (/\bsin garaje\b/i.test(t)) {
    result.garaje = false;
  }

  // ── TRASTERO ─────────────────────────────────────────────────────────
  if (/\b(?:con\s+)?trastero\b/i.test(t) && !/\bsin trastero\b/i.test(t)) {
    result.trastero = true;
  } else if (/\bsin trastero\b/i.test(t)) {
    result.trastero = false;
  }

  // ── TERRAZA ──────────────────────────────────────────────────────────
  if (/\b(?:terraza|balc[oó]n|porche|jard[ií]n privado)\b/i.test(t) && !/\bsin terraza\b/i.test(t)) {
    result.terraza = true;
  }

  // ── ESTADO ───────────────────────────────────────────────────────────
  result.estado = detectStatus(t);
  if (result.estado === 'Agotada/Vendida') {
    const soldHousing = /(?:viviendas|pisos|unidades|promoci[oó]n).{0,60}(?:agotad[ao]s?|vendid[ao]s?)|(?:agotad[ao]s?|vendid[ao]s?).{0,60}(?:viviendas|pisos|unidades|promoci[oó]n)|no quedan|completamente vendid[ao]/i;
    if (!soldHousing.test(t)) result.estado = null;
  }

  // Los nombres propios y empresas no se extraen con regex: en prensa las
  // expresiones son voraces y producen fragmentos. El LLM propone y el
  // validador exige evidencia literal antes de persistirlos.

  // ── LLM NEEDED? ──────────────────────────────────────────────────────
  // If we got fewer than 3 non-null fields, the text is probably too
  // unstructured for regex alone — signal the caller to invoke the LLM.
  const nonNull = Object.values(result).filter((v) => v !== null && v !== undefined).length;
  result._regexFieldsFound = nonNull;
  result._llmNeeded = nonNull < 3;

  return result;
}

function parseNumber(str) {
  const cleaned = String(str).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  const rounded = Math.round(n);
  // Filter out garbage prices: no real housing in this area is under 100k
  return rounded >= 100000 ? rounded : null;
}
