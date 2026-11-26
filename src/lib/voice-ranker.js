/**
 * ChalaVoiceRanker — Detector local de idioma y clasificador inteligente multiplataforma
 * de voces (Windows, macOS, Linux, ChromeOS).
 *
 * Diseñado como IIFE idempotente compatible tanto con chrome.scripting.executeScript
 * (sin sentencias export/import) como con importación en páginas de extensión y Node.js.
 */
(function (globalScope) {
  "use strict";

  var STOPWORDS = {
    es: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "por", "con", "para", "como", "del", "al", "se", "no", "su", "es"],
    en: ["the", "and", "of", "to", "in", "is", "it", "you", "that", "for", "with", "on", "are", "as", "be", "this", "from", "or", "by", "not"],
    pt: ["o", "a", "os", "as", "de", "que", "e", "em", "um", "uma", "para", "com", "não", "por", "como", "do", "da", "na", "no", "se"],
    fr: ["le", "la", "les", "de", "des", "et", "en", "un", "une", "que", "pour", "dans", "est", "pas", "avec", "sur", "au", "aux", "qui", "ce"],
    it: ["il", "la", "lo", "i", "gli", "le", "di", "che", "e", "in", "un", "una", "per", "con", "non", "del", "della", "sono", "da", "si"],
    de: ["der", "die", "das", "und", "in", "den", "von", "zu", "mit", "ist", "ein", "eine", "auf", "für", "nicht", "es", "auch", "sich", "als", "des"]
  };

  var QUALITY_PATTERNS = [
    { re: /\b(natural|neural|online)\b/i, score: 65, tier: "neural" },
    { re: /\bmultilingual\b/i, score: 25, tier: "neural" },
    { re: /\b(google|apple|siri|premium|enhanced|studio)\b/i, score: 45, tier: "enhanced" },
    { re: /\bmicrosoft\b/i, score: 20, tier: "system" },
    { re: /\b(espeak|mbrola|festival|eloquence|compact|robot)\b/i, score: -40, tier: "basic" }
  ];

  function normalizeLangTag(lang) {
    return String(lang || "")
      .trim()
      .replace(/_/g, "-")
      .toLowerCase();
  }

  function detectLanguage(text, declaredLang) {
    var cleanDeclared = normalizeLangTag(declaredLang || "");
    if (/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(cleanDeclared)) {
      return cleanDeclared;
    }

    var sample = String(text || "").slice(0, 4000).toLowerCase();
    if (!sample.trim()) {
      return "es";
    }

    var words = sample.match(/\p{L}+/gu) || [];
    var scores = { es: 0, en: 0, pt: 0, fr: 0, it: 0, de: 0 };

    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      var langs = Object.keys(STOPWORDS);
      for (var j = 0; j < langs.length; j += 1) {
        var lang = langs[j];
        if (STOPWORDS[lang].indexOf(word) !== -1) {
          scores[lang] += 2;
        }
      }
    }

    if (/[ñ¿¡]/.test(sample)) scores.es += 12;
    if (/[áéíóúü]/.test(sample)) scores.es += 3;
    if (/[ãõç]/.test(sample)) scores.pt += 10;
    if (/[àâçéèêëîïôùûüœ]/.test(sample)) scores.fr += 4;
    if (/[äöüß]/.test(sample)) scores.de += 10;

    var bestLang = "es";
    var bestScore = -1;
    var keys = Object.keys(scores);
    for (var k = 0; k < keys.length; k += 1) {
      var l = keys[k];
      if (scores[l] > bestScore) {
        bestScore = scores[l];
        bestLang = l;
      }
    }

    return bestScore > 0 ? bestLang : "es";
  }

  function scoreVoice(voice, targetLang) {
    var name = String((voice && voice.name) || "");
    var vLang = normalizeLangTag((voice && voice.lang) || "");
    var tLang = normalizeLangTag(targetLang || "es");
    var vPrimary = vLang.split("-")[0];
    var tPrimary = tLang.split("-")[0];

    var score = 0;
    var langMatch = "none";

    if (vLang && tLang && vLang === tLang) {
      score += 120;
      langMatch = "exact";
    } else if (vPrimary && tPrimary && vPrimary === tPrimary) {
      score += 95;
      langMatch = "primary";
    } else {
      score -= 80;
    }

    var qualityTier = voice && voice.localService === false ? "cloud" : "standard";

    for (var i = 0; i < QUALITY_PATTERNS.length; i += 1) {
      var rule = QUALITY_PATTERNS[i];
      if (rule.re.test(name)) {
        score += rule.score;
        if (rule.score > 0 && qualityTier === "standard") {
          qualityTier = rule.tier;
        } else if (rule.score < 0) {
          qualityTier = rule.tier;
        }
      }
    }

    if (voice && voice.localService === false) {
      score += 15;
    }

    if (voice && voice.default && langMatch !== "none") {
      score += 5;
    }

    return { score: score, qualityTier: qualityTier, langMatch: langMatch };
  }

  function rankVoices(voices, targetLang) {
    var list = Array.isArray(voices) ? voices : [];
    var tLang = targetLang || "es";
    return list
      .map(function (voice, idx) {
        var meta = scoreVoice(voice, tLang);
        return {
          voice: voice,
          name: String((voice && voice.name) || "Voice " + (idx + 1)),
          voiceURI: String((voice && (voice.voiceURI || voice.name)) || "voice_" + idx),
          lang: String((voice && voice.lang) || ""),
          localService: Boolean(voice && voice.localService),
          score: meta.score,
          qualityTier: meta.qualityTier,
          langMatch: meta.langMatch
        };
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      });
  }

  function loadVoices(synth, timeoutMs) {
    var waitMs = typeof timeoutMs === "number" ? timeoutMs : 1500;
    if (!synth || typeof synth.getVoices !== "function") {
      return Promise.resolve([]);
    }
    var initial = synth.getVoices() || [];
    if (initial.length > 0) {
      return Promise.resolve(initial);
    }

    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      var handler = function () {
        var list = synth.getVoices() || [];
        if (list.length > 0) {
          finish(list);
        }
      };
      var finish = function (voices) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if ("onvoiceschanged" in synth && synth.onvoiceschanged === handler) {
          synth.onvoiceschanged = null;
        }
        resolve(voices || []);
      };
      timer = setTimeout(function () {
        finish(synth.getVoices() || []);
      }, waitMs);

      if (typeof synth.addEventListener === "function") {
        synth.addEventListener("voiceschanged", handler, { once: true });
      } else {
        synth.onvoiceschanged = handler;
      }
    });
  }

  globalScope.ChalaVoiceRanker = {
    normalizeLangTag: normalizeLangTag,
    detectLanguage: detectLanguage,
    scoreVoice: scoreVoice,
    rankVoices: rankVoices,
    loadVoices: loadVoices
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
