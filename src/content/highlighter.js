/**
 * ChalaVoiceHighlighter — Content script inyectado bajo demanda.
 * Extrae bloques legibles con IDs estables (data-chalavoice-id), resalta en vivo
 * el párrafo y la oración activa mediante CSS Custom Highlight API / outline
 * con auto-scroll suave y permite hacer clic en cualquier párrafo para saltar.
 *
 * IIFE idempotente sin sentencias export/import.
 */
(function (globalScope) {
  "use strict";

  var STYLE_ID = "chalavoice-styles";
  var HIGHLIGHT_KEY = "chalavoice-sentence";
  var BLOCK_ATTR = "data-chalavoice-id";
  var ACTIVE_ATTR = "data-chalavoice-active";

  if (globalScope.ChalaVoiceHighlighter) {
    return;
  }

  var state = {
    active: false,
    elements: [],
    activeIndex: -1,
    clickBound: false
  };

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "[" + ACTIVE_ATTR + '="true"] {',
      "  outline: 2px solid #10B981 !important;",
      "  outline-offset: 4px !important;",
      "  background-color: rgba(16, 185, 129, 0.14) !important;",
      "  border-radius: 6px !important;",
      "  scroll-margin-block: 120px !important;",
      "  transition: background-color 180ms ease, outline-color 180ms ease !important;",
      "}",
      "[" + BLOCK_ATTR + "]:hover {",
      "  cursor: pointer;",
      "}",
      "::highlight(" + HIGHLIGHT_KEY + ") {",
      "  background-color: rgba(6, 182, 212, 0.32);",
      "  color: inherit;",
      "}"
    ].join("\n");
    var parent = document.head || document.documentElement;
    if (parent) {
      parent.appendChild(style);
    }
  }

  function removeStyles() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function clearSentenceHighlight() {
    if (globalScope.CSS && globalScope.CSS.highlights && typeof globalScope.CSS.highlights.delete === "function") {
      globalScope.CSS.highlights.delete(HIGHLIGHT_KEY);
    }
  }

  function highlightSentenceInElement(el, sentenceText) {
    clearSentenceHighlight();
    if (!el || !sentenceText) return;
    if (!globalScope.CSS || !globalScope.CSS.highlights || typeof globalScope.Highlight !== "function") {
      return;
    }
    if (typeof document.createTreeWalker !== "function" || typeof document.createRange !== "function") {
      return;
    }

    var target = sentenceText.trim().slice(0, 80);
    if (!target) return;

    var textNodes = [];
    var fullText = "";
    var walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    var node;
    while ((node = walker.nextNode())) {
      var val = node.nodeValue || "";
      if (!val) continue;
      textNodes.push({ node: node, start: fullText.length, end: fullText.length + val.length });
      fullText += val;
    }

    if (!fullText) return;
    var normFull = fullText.replace(/\s+/g, " ");
    var matchIdx = normFull.indexOf(target);
    if (matchIdx === -1) {
      var shortProbe = target.slice(0, 28);
      matchIdx = normFull.indexOf(shortProbe);
      if (matchIdx === -1) return;
      target = shortProbe;
    }

    // Mapear posición aproximada en el texto sin colapsar si coincide directamente
    var rawIdx = fullText.indexOf(target);
    if (rawIdx === -1) return;
    var rawEnd = rawIdx + target.length;

    var startPos = null;
    var endPos = null;
    for (var i = 0; i < textNodes.length; i += 1) {
      var tn = textNodes[i];
      if (!startPos && rawIdx >= tn.start && rawIdx < tn.end) {
        startPos = { node: tn.node, offset: rawIdx - tn.start };
      }
      if (rawEnd > tn.start && rawEnd <= tn.end) {
        endPos = { node: tn.node, offset: rawEnd - tn.start };
        break;
      }
    }

    if (startPos && endPos) {
      try {
        var range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        var hl = new globalScope.Highlight(range);
        globalScope.CSS.highlights.set(HIGHLIGHT_KEY, hl);
      } catch {
        // Ignorar si el rango es inválido por mutaciones externas del sitio
      }
    }
  }

  function clearAll() {
    state.active = false;
    state.activeIndex = -1;
    clearSentenceHighlight();

    var tagged = document.querySelectorAll("[" + BLOCK_ATTR + "]");
    for (var i = 0; i < tagged.length; i += 1) {
      tagged[i].removeAttribute(ACTIVE_ATTR);
      tagged[i].removeAttribute(BLOCK_ATTR);
    }
    state.elements = [];
    removeStyles();
  }

  function prepareAndExtract() {
    clearAll();
    if (!globalScope.ChalaVoiceReadability) {
      return { ok: false, reason: "MISSING_READABILITY" };
    }

    var found = globalScope.ChalaVoiceReadability.findReadableElements(document);
    var article = globalScope.ChalaVoiceReadability.extractArticle(document);

    ensureStyles();
    state.active = true;
    state.elements = found.elements || [];

    for (var i = 0; i < state.elements.length; i += 1) {
      var el = state.elements[i];
      if (el && typeof el.setAttribute === "function") {
        el.setAttribute(BLOCK_ATTR, String(i));
      }
    }

    bindClickToJump();
    return { ok: true, article: article };
  }

  function highlightChunk(paragraphIndex, sentenceText) {
    if (!state.active) return { ok: false };
    ensureStyles();

    if (state.activeIndex >= 0 && state.elements[state.activeIndex]) {
      state.elements[state.activeIndex].removeAttribute(ACTIVE_ATTR);
    }
    var prevActive = document.querySelectorAll("[" + ACTIVE_ATTR + '="true"]');
    for (var i = 0; i < prevActive.length; i += 1) {
      prevActive[i].removeAttribute(ACTIVE_ATTR);
    }

    var target = state.elements[paragraphIndex] || document.querySelector("[" + BLOCK_ATTR + '="' + paragraphIndex + '"]');
    if (!target) return { ok: false };

    state.activeIndex = paragraphIndex;
    target.setAttribute(ACTIVE_ATTR, "true");
    highlightSentenceInElement(target, sentenceText);

    if (typeof target.scrollIntoView === "function") {
      var shouldScroll = true;
      if (typeof target.getBoundingClientRect === "function" && typeof globalScope.innerHeight === "number") {
        var rect = target.getBoundingClientRect();
        var vh = globalScope.innerHeight;
        if (rect.top >= vh * 0.15 && rect.bottom <= vh * 0.85) {
          shouldScroll = false;
        }
      }
      if (shouldScroll) {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          target.scrollIntoView(true);
        }
      }
    }

    return { ok: true, paragraphIndex: paragraphIndex };
  }

  function findClosestBlockElement(node) {
    var cur = node;
    while (cur && cur.nodeType === 1) {
      if (cur.hasAttribute && cur.hasAttribute(BLOCK_ATTR)) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function bindClickToJump() {
    if (state.clickBound) return;
    state.clickBound = true;

    document.addEventListener("click", function (event) {
      if (!state.active || !event || !event.target) return;

      // No interferir si el usuario está seleccionando texto o haciendo clic en enlaces/botones
      if (typeof globalScope.getSelection === "function") {
        var sel = globalScope.getSelection();
        if (sel && String(sel.toString() || "").trim().length > 0) return;
      }

      var cur = event.target;
      while (cur && cur.nodeType === 1) {
        var tag = String(cur.tagName || "").toUpperCase();
        if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
          return;
        }
        cur = cur.parentNode;
      }

      var block = findClosestBlockElement(event.target);
      if (!block) return;

      var idx = Number.parseInt(block.getAttribute(BLOCK_ATTR), 10);
      if (!Number.isFinite(idx)) return;

      if (globalScope.chrome?.runtime?.sendMessage) {
        try {
          var p = globalScope.chrome.runtime.sendMessage({
            type: "CHALAVOICE_JUMP_TO_PARAGRAPH",
            paragraphIndex: idx
          });
          if (p && typeof p.catch === "function") p.catch(function () {});
        } catch {
          // Ignorar errores de mensajería si el panel se cerró
        }
      }
    });
  }

  if (globalScope.chrome?.runtime?.onMessage?.addListener) {
    globalScope.chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || typeof message.type !== "string") return false;
      if (message.type === "CHALAVOICE_CONTENT_EXTRACT") {
        sendResponse(prepareAndExtract());
        return false;
      }
      if (message.type === "CHALAVOICE_CONTENT_HIGHLIGHT") {
        sendResponse(highlightChunk(Number(message.paragraphIndex) || 0, String(message.sentenceText || "")));
        return false;
      }
      if (message.type === "CHALAVOICE_CONTENT_CLEAR") {
        clearAll();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }

  globalScope.ChalaVoiceHighlighter = {
    prepareAndExtract: prepareAndExtract,
    highlightChunk: highlightChunk,
    clearAll: clearAll,
    getState: function () {
      return {
        active: state.active,
        blockCount: state.elements.length,
        activeIndex: state.activeIndex
      };
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
