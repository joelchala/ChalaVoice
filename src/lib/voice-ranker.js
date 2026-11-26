/**
 * Detector local de idioma y clasificador inteligente multiplataforma de voces
 * (Windows, macOS, Linux, ChromeOS) para ChalaVoice.
 */

const STOPWORDS = {
  es: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "por", "con", "para", "como", "del", "al", "se", "no", "su", "es"],
  en: ["the", "and", "of", "to", "in", "is", "it", "you", "that", "for", "with", "on", "are", "as", "be", "this", "from", "or", "by", "not"],
  pt: ["o", "a", "os", "as", "de", "que", "e", "em", "um", "uma", "para", "com", "não", "por", "como", "do", "da", "na", "no", "se"],
  fr: ["le", "la", "les", "de", "des", "et", "en", "un", "une", "que", "pour", "dans", "est", "pas", "avec", "sur", "au", "aux", "qui", "ce"],
  it: ["il", "la", "lo", "i", "gli", "le", "di", "che", "e", "in", "un", "una", "per", "con", "non", "del", "della", "sono", "da", "si"],
  de: ["der", "die", "das", "und", "in", "den", "von", "zu", "mit", "ist", "ein", "eine", "auf", "für", "nicht", "es", "auch", "sich", "als", "des"]
};

const QUALITY_PATTERNS = [
  { re: /\b(natural|neural|online)\b/i, score: 65, tier: "neural" },
  { re: /\bmultilingual\b/i, score: 25, tier: "neural" },
  { re: /\b(google|apple|siri|premium|enhanced|studio)\b/i, score: 45, tier: "enhanced" },
  { re: /\bmicrosoft\b/i, score: 20, tier: "system" },
  { re: /\b(espeak|mbrola|festival|eloquence|compact|robot)\b/i, score: -40, tier: "basic" }
];

/**
 * Normaliza un código BCP-47 (ej. "es_MX" -> "es-mx").
 * @param {string} lang
 */
export function normalizeLangTag(lang) {
  return String(lang || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
}

/**
 * Detecta el idioma probable del texto (o respeta un idioma declarado válido).
 * @param {string} text
 * @param {string} [declaredLang]
 * @returns {string}
 */
export function detectLanguage(text, declaredLang = "") {
  const cleanDeclared = normalizeLangTag(declaredLang);
  if (/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(cleanDeclared)) {
    return cleanDeclared;
  }

  const sample = String(text || "").slice(0, 4000).toLowerCase();
  if (!sample.trim()) {
    return "es";
  }

  const words = sample.match(/\p{L}+/gu) || [];
  const scores = { es: 0, en: 0, pt: 0, fr: 0, it: 0, de: 0 };

  for (const word of words) {
    for (const [lang, list] of Object.entries(STOPWORDS)) {
      if (list.includes(word)) {
        scores[lang] += 2;
      }
    }
  }

  // Pistas ortográficas específicas
  if (/[ñ¿¡]/.test(sample)) scores.es += 12;
  if (/[áéíóúü]/.test(sample)) scores.es += 3;
  if (/[ãõç]/.test(sample)) scores.pt += 10;
  if (/[àâçéèêëîïôùûüœ]/.test(sample)) scores.fr += 4;
  if (/[äöüß]/.test(sample)) scores.de += 10;

  let bestLang = "es";
  let bestScore = -1;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestScore > 0 ? bestLang : "es";
}

/**
 * Calcula la puntuación de idoneidad de una voz para el idioma destino.
 * @param {{ name?: string, voiceURI?: string, lang?: string, localService?: boolean, default?: boolean }} voice
 * @param {string} targetLang
 */
export function scoreVoice(voice, targetLang = "es") {
  const name = String(voice?.name || "");
  const vLang = normalizeLangTag(voice?.lang || "");
  const tLang = normalizeLangTag(targetLang || "es");
  const vPrimary = vLang.split("-")[0];
  const tPrimary = tLang.split("-")[0];

  let score = 0;
  let langMatch = "none";

  if (vLang && tLang && vLang === tLang) {
    score += 120;
    langMatch = "exact";
  } else if (vPrimary && tPrimary && vPrimary === tPrimary) {
    score += 95;
    langMatch = "primary";
  } else {
    score -= 80;
  }

  let qualityTier = voice?.localService === false ? "cloud" : "standard";

  for (const rule of QUALITY_PATTERNS) {
    if (rule.re.test(name)) {
      score += rule.score;
      if (rule.score > 0 && qualityTier === "standard") {
        qualityTier = rule.tier;
      } else if (rule.score < 0) {
        qualityTier = rule.tier;
      }
    }
  }

  // En Chromium/Edge, las voces online suelen corresponder a voces neurales de alta calidad
  if (voice?.localService === false) {
    score += 15;
  }

  if (voice?.default && langMatch !== "none") {
    score += 5;
  }

  return { score, qualityTier, langMatch };
}

/**
 * Ordena las voces disponibles poniendo primero las que coinciden con el idioma
 * y tienen mayor calidad acústica (Natural/Neural/Online/Google/Apple).
 * @param {Array} voices
 * @param {string} [targetLang]
 */
export function rankVoices(voices, targetLang = "es") {
  const list = Array.isArray(voices) ? voices : [];
  return list
    .map((voice, idx) => {
      const meta = scoreVoice(voice, targetLang);
      return {
        voice,
        name: String(voice?.name || `Voice ${idx + 1}`),
        voiceURI: String(voice?.voiceURI || voice?.name || `voice_${idx}`),
        lang: String(voice?.lang || ""),
        localService: Boolean(voice?.localService),
        score: meta.score,
        qualityTier: meta.qualityTier,
        langMatch: meta.langMatch
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Carga voces de Web Speech API escuchando `onvoiceschanged` si inicialmente está vacío.
 * @param {SpeechSynthesis} synth
 * @param {number} [timeoutMs]
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function loadVoices(synth, timeoutMs = 1500) {
  if (!synth || typeof synth.getVoices !== "function") {
    return Promise.resolve([]);
  }
  const initial = synth.getVoices() || [];
  if (initial.length > 0) {
    return Promise.resolve(initial);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ("onvoiceschanged" in synth && synth.onvoiceschanged === handler) {
        synth.onvoiceschanged = null;
      }
      resolve(voices || []);
    };
    const handler = () => {
      const list = synth.getVoices() || [];
      if (list.length > 0) {
        finish(list);
      }
    };
    const timer = setTimeout(() => {
      finish(synth.getVoices() || []);
    }, timeoutMs);

    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", handler, { once: true });
    } else {
      synth.onvoiceschanged = handler;
    }
  });
}
