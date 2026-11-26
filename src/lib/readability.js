/**
 * ChalaVoiceReadability — Extractor heurístico local de contenido legible.
 * Diseñado como IIFE idempotente compatible con chrome.scripting.executeScript
 * (sin sentencias export/import) y con pruebas ESM en Node.js.
 *
 * No muta el DOM anfitrión: identifica los elementos reales del artículo principal
 * para lectura en voz alta y resaltado en vivo sin romper la página web.
 */
(function (globalScope) {
  "use strict";

  var REGEXPS = {
    unlikelyCandidates:
      /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|agegate|pagination|pager|popup|yom-remote|cookie|newsletter|share-buttons|promo|widget|toc-wrapper|modal|overlay|nav/i,
    okMaybeItsACandidate:
      /and|article|body|column|content|main|shadow|post|entry|story|prose|markdown|readme/i,
    positive:
      /article|body|content|entry|hentry|h-entry|main|page|post|text|blog|story|prose|markdown|readme/i,
    negative:
      /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget|cookie|newsletter|nav/i,
    whitespace: /\s+/g,
    commas: /[,，;؛]/g
  };

  var UNWANTED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "IFRAME",
    "FRAME",
    "FRAMESET",
    "OBJECT",
    "EMBED",
    "PARAM",
    "SVG",
    "CANVAS",
    "FORM",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
    "BUTTON",
    "DIALOG",
    "NAV",
    "ASIDE",
    "FOOTER",
    "HEADER",
    "MENU",
    "MENUITEM",
    "AUDIO",
    "VIDEO",
    "FIGURE",
    "FIGCAPTION"
  ]);

  var BLOCK_TAGS = new Set([
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "BLOCKQUOTE",
    "LI",
    "PRE"
  ]);

  var CHILD_BLOCK_SELECTOR = "p, blockquote, ul, ol, li, h1, h2, h3, h4, h5, h6, pre, table, article, section, main, div";

  function upperTag(node) {
    return node && node.tagName ? String(node.tagName).toUpperCase() : "";
  }

  function normalizeText(str) {
    return String(str || "")
      .replace(REGEXPS.whitespace, " ")
      .trim();
  }

  function getWordCount(text) {
    var clean = normalizeText(text);
    if (!clean) return 0;
    return clean.split(" ").filter(Boolean).length;
  }

  function estimateReadingMinutes(wordCount, wpm) {
    var rate = typeof wpm === "number" && wpm > 0 ? wpm : 150;
    if (!wordCount || wordCount <= 0) return 1;
    return Math.max(1, Math.ceil(wordCount / rate));
  }

  function isProbablyHidden(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hidden) return true;
    if (node.hasAttribute && node.hasAttribute("hidden")) return true;
    var ariaHidden = node.getAttribute && node.getAttribute("aria-hidden");
    if (ariaHidden === "true") {
      var cls = typeof node.className === "string" ? node.className : "";
      if (!/math|katex|mjx/i.test(cls)) return true;
    }
    var style = String((node.getAttribute && node.getAttribute("style")) || "").toLowerCase();
    if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) {
      return true;
    }
    return false;
  }

  function isNoiseElement(node) {
    if (!node || node.nodeType !== 1) return true;
    var tag = upperTag(node);
    if (UNWANTED_TAGS.has(tag)) return true;
    if (isProbablyHidden(node)) return true;
    if (tag === "BODY" || tag === "HTML" || tag === "ARTICLE" || tag === "MAIN") {
      return false;
    }
    var cls = typeof node.className === "string" ? node.className : "";
    var id = typeof node.id === "string" ? node.id : "";
    var matchString = (cls + " " + id).trim();
    if (
      matchString &&
      REGEXPS.unlikelyCandidates.test(matchString) &&
      !REGEXPS.okMaybeItsACandidate.test(matchString)
    ) {
      var textLen = normalizeText(node.textContent).length;
      if (textLen < 800 || !(node.querySelector && node.querySelector("article, main, p"))) {
        return true;
      }
    }
    return false;
  }

  function hasNoiseAncestor(node, stopAt) {
    var cur = node;
    while (cur && cur !== stopAt && cur.nodeType === 1) {
      if (isNoiseElement(cur)) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  function getClassWeight(node) {
    var weight = 0;
    if (!node || node.nodeType !== 1) return weight;
    var cls = typeof node.className === "string" ? node.className : "";
    var id = typeof node.id === "string" ? node.id : "";
    if (cls) {
      if (REGEXPS.negative.test(cls)) weight -= 25;
      if (REGEXPS.positive.test(cls)) weight += 25;
    }
    if (id) {
      if (REGEXPS.negative.test(id)) weight -= 25;
      if (REGEXPS.positive.test(id)) weight += 25;
    }
    return weight;
  }

  function getTagInitialScore(tagName) {
    switch (tagName) {
      case "MAIN":
        return 14;
      case "ARTICLE":
        return 12;
      case "SECTION":
      case "DIV":
        return 5;
      case "BLOCKQUOTE":
        return 3;
      default:
        return 0;
    }
  }

  function getLinkDensity(node) {
    var textLen = normalizeText(node.textContent).length;
    if (textLen === 0) return 0;
    var links = node.querySelectorAll ? node.querySelectorAll("a") : [];
    var linkLen = 0;
    for (var i = 0; i < links.length; i += 1) {
      var href = (links[i].getAttribute && links[i].getAttribute("href")) || "";
      var coeff = href.startsWith("#") ? 0.3 : 1;
      linkLen += normalizeText(links[i].textContent).length * coeff;
    }
    return linkLen / textLen;
  }

  function getMetaContent(doc, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var el = doc.querySelector(selectors[i]);
      if (el) {
        var content = (el.getAttribute("content") || el.textContent || "").trim();
        if (content) return normalizeText(content);
      }
    }
    return "";
  }

  function extractMetadata(doc) {
    var rawTitle = normalizeText(doc.title || "");
    var ogTitle = getMetaContent(doc, [
      'meta[property="og:title" i]',
      'meta[name="twitter:title" i]',
      'meta[name="dc:title" i]'
    ]);
    var h1 = doc.querySelector("article h1, main h1, h1");
    var h1Text = h1 ? normalizeText(h1.textContent) : "";

    var title = ogTitle || rawTitle;
    if (title && /\s[|\-–—/»]\s/.test(title)) {
      var first = title.split(/\s[|\-–—/»]\s/)[0].trim();
      if (getWordCount(first) >= 2) title = first;
    }
    if (!title && h1Text) {
      title = h1Text;
    } else if (h1Text && h1Text.length >= 8 && h1Text.length <= 180 && title.toLowerCase().includes(h1Text.toLowerCase())) {
      title = h1Text;
    }

    var byline = getMetaContent(doc, [
      'meta[name="author" i]',
      'meta[property="article:author" i]',
      'meta[name="dc:creator" i]'
    ]);
    var siteName = getMetaContent(doc, [
      'meta[property="og:site_name" i]',
      'meta[name="application-name" i]'
    ]);
    if (!siteName && doc.URL) {
      try {
        siteName = new URL(doc.URL).hostname.replace(/^www\./i, "");
      } catch {
        siteName = "";
      }
    }

    var docLang = "";
    if (doc.documentElement && doc.documentElement.getAttribute) {
      docLang = (doc.documentElement.getAttribute("lang") || "").trim();
    }

    return {
      title: title || "Artículo web",
      byline: byline,
      siteName: siteName,
      lang: docLang
    };
  }

  function selectTopContainer(doc) {
    if (!doc || !doc.body) return null;

    var scoreMap = new Map();
    var candidates = [];

    function ensureCandidate(el) {
      if (!scoreMap.has(el)) {
        var entry = {
          node: el,
          score: getTagInitialScore(upperTag(el)) + getClassWeight(el)
        };
        scoreMap.set(el, entry);
        candidates.push(entry);
      }
      return scoreMap.get(el);
    }

    var proseNodes = doc.body.querySelectorAll("p, blockquote, li, pre");
    for (var i = 0; i < proseNodes.length; i += 1) {
      var el = proseNodes[i];
      if (hasNoiseAncestor(el, doc.body)) continue;
      var text = normalizeText(el.textContent);
      if (text.length < 25) continue;

      var contentScore = 1 + (text.match(REGEXPS.commas) || []).length + Math.min(Math.floor(text.length / 100), 3);
      if (upperTag(el) === "P") contentScore += 1;

      var cur = el.parentNode;
      var depth = 0;
      while (cur && cur.nodeType === 1 && upperTag(cur) !== "HTML" && depth < 5) {
        if (!isNoiseElement(cur)) {
          var entry = ensureCandidate(cur);
          var divider = depth === 0 ? 1 : depth === 1 ? 2 : depth * 3;
          entry.score += contentScore / divider;
        }
        cur = cur.parentNode;
        depth += 1;
      }
    }

    for (var k = 0; k < candidates.length; k += 1) {
      var cand = candidates[k];
      var linkDensity = getLinkDensity(cand.node);
      cand.score = cand.score * (1 - linkDensity);
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    if (candidates[0] && candidates[0].score > 0) {
      return candidates[0].node;
    }

    var semantic = doc.body.querySelector("article, main, [role='main']");
    return semantic || doc.body;
  }

  function isLeafReadableDiv(node) {
    if (upperTag(node) !== "DIV") return false;
    if (node.querySelector && node.querySelector(CHILD_BLOCK_SELECTOR)) {
      return false;
    }
    var text = normalizeText(node.textContent);
    if (text.length < 30) return false;
    if (getLinkDensity(node) > 0.5) return false;
    return true;
  }

  /**
   * Localiza los elementos DOM vivos legibles dentro del contenedor principal sin mutar la página.
   * @param {Document} doc
   */
  function findReadableElements(doc) {
    if (!doc || !doc.body) {
      return {
        metadata: { title: "Artículo web", byline: "", siteName: "", lang: "" },
        container: null,
        elements: []
      };
    }

    var metadata = extractMetadata(doc);
    var container = selectTopContainer(doc) || doc.body;
    var elements = [];
    var seenTexts = new Set();

    function collectFrom(root) {
      var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (var i = 0; i < all.length; i += 1) {
        var el = all[i];
        var tag = upperTag(el);
        var isBlock = BLOCK_TAGS.has(tag) || isLeafReadableDiv(el);
        if (!isBlock) continue;
        if (hasNoiseAncestor(el, root)) continue;

        // Evitar duplicar un <li> o <blockquote> si ya contiene un <p> interno que también se extrae
        if ((tag === "BLOCKQUOTE" || tag === "LI") && el.querySelector && el.querySelector("p")) {
          continue;
        }

        var text = normalizeText(el.textContent);
        if (!text) continue;
        if (/^H[1-6]$/.test(tag) && text.length < 3) continue;
        if (tag === "P" && text.length < 15) continue;
        if (tag === "LI" && text.length < 12) continue;

        var linkDensity = getLinkDensity(el);
        if (linkDensity > 0.65 && text.length < 160 && !/^H[1-6]$/.test(tag)) {
          continue;
        }

        if (seenTexts.has(text)) continue;
        seenTexts.add(text);
        elements.push(el);
      }
    }

    collectFrom(container);

    if (elements.length === 0 && container !== doc.body) {
      collectFrom(doc.body);
    }

    return {
      metadata: metadata,
      container: container,
      elements: elements
    };
  }

  /**
   * Extrae un objeto serializable con metadatos, bloques numerados y métricas de lectura.
   * @param {Document} doc
   * @param {{ wordsPerMinute?: number }} [options]
   */
  function extractArticle(doc, options) {
    var opts = options || {};
    var wpm = opts.wordsPerMinute || 150;
    var found = findReadableElements(doc);
    var blocks = [];
    var textParts = [];

    for (var i = 0; i < found.elements.length; i += 1) {
      var el = found.elements[i];
      var text = normalizeText(el.textContent);
      if (!text) continue;
      blocks.push({
        index: blocks.length,
        tag: upperTag(el),
        text: text
      });
      textParts.push(text);
    }

    var textContent = textParts.join("\n\n");
    var wordCount = getWordCount(textContent);

    return {
      title: found.metadata.title,
      byline: found.metadata.byline,
      siteName: found.metadata.siteName,
      lang: found.metadata.lang,
      blocks: blocks,
      textContent: textContent,
      wordCount: wordCount,
      readingTimeMinutes: estimateReadingMinutes(wordCount, wpm)
    };
  }

  var api = {
    extractArticle: extractArticle,
    findReadableElements: findReadableElements,
    normalizeText: normalizeText,
    estimateReadingMinutes: estimateReadingMinutes
  };

  globalScope.ChalaVoiceReadability = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
