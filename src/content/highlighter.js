/**
 * ChalaVoiceHighlighter — Motor persistente en pestaña, Mini Barra Flotante (Shadow DOM)
 * y Modo Inspector visual ("Seleccionar párrafo inicial").
 *
 * IIFE idempotente sin sentencias export/import (compatible con chrome.scripting.executeScript).
 */
(function (globalScope) {
  "use strict";

  var STYLE_ID = "chalavoice-styles";
  var MINIBAR_HOST_ID = "chalavoice-minibar-host";
  var TOOLTIP_HOST_ID = "chalavoice-inspector-tooltip";
  var HIGHLIGHT_KEY = "chalavoice-sentence";
  var BLOCK_ATTR = "data-chalavoice-id";
  var ACTIVE_ATTR = "data-chalavoice-active";
  var INSPECT_ATTR = "data-chalavoice-inspect-hover";

  if (globalScope.ChalaVoiceHighlighter) {
    return;
  }

  var state = {
    elements: [],
    article: null,
    activeIndex: -1,
    engine: null,
    voices: [],
    rankedVoices: [],
    settings: {
      preset: "natural",
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      paragraphPauseMs: 500,
      voiceURI: ""
    },
    inspectorActive: false,
    hoveredElement: null,
    minibarMinimized: false,
    minibarPos: null,
    minibarHost: null,
    minibarShadow: null,
    tooltipHost: null,
    tooltipShadow: null
  };

  function msg(key, fallback) {
    try {
      return (globalScope.chrome && globalScope.chrome.i18n && globalScope.chrome.i18n.getMessage(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "[" + ACTIVE_ATTR + '="true"] {',
      "  outline: 2px solid #F97316 !important;",
      "  outline-offset: 4px !important;",
      "  background-color: rgba(249, 115, 22, 0.14) !important;",
      "  border-radius: 6px !important;",
      "  scroll-margin-block: 120px !important;",
      "  transition: background-color 180ms ease, outline-color 180ms ease !important;",
      "}",
      "[" + INSPECT_ATTR + '="true"] {',
      "  outline: 2px solid #F97316 !important;",
      "  outline-offset: 3px !important;",
      "  background-color: rgba(249, 115, 22, 0.16) !important;",
      "  border-radius: 6px !important;",
      "  cursor: crosshair !important;",
      "}",
      "::highlight(" + HIGHLIGHT_KEY + ") {",
      "  background-color: rgba(249, 115, 22, 0.30);",
      "  color: inherit;",
      "}"
    ].join("\n");
    var parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
  }

  function removeStylesIfIdle() {
    if (state.inspectorActive || (state.engine && state.engine.state !== "idle")) return;
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function clearSentenceHighlight() {
    if (globalScope.CSS && globalScope.CSS.highlights && typeof globalScope.CSS.highlights.delete === "function") {
      globalScope.CSS.highlights.delete(HIGHLIGHT_KEY);
    }
  }

  function highlightSentenceInElement(el, sentenceText) {
    clearSentenceHighlight();
    if (!el || !sentenceText) return;
    if (!globalScope.CSS || !globalScope.CSS.highlights || typeof globalScope.Highlight !== "function") return;
    if (typeof document.createTreeWalker !== "function" || typeof document.createRange !== "function") return;

    var target = sentenceText.trim().slice(0, 80);
    if (!target) return;

    var textNodes = [];
    var fullText = "";
    var walker = document.createTreeWalker(el, 4);
    var node;
    while ((node = walker.nextNode())) {
      var val = node.nodeValue || "";
      if (!val) continue;
      textNodes.push({ node: node, start: fullText.length, end: fullText.length + val.length });
      fullText += val;
    }
    if (!fullText) return;

    var rawIdx = fullText.indexOf(target);
    if (rawIdx === -1) {
      target = target.slice(0, 28);
      rawIdx = fullText.indexOf(target);
      if (rawIdx === -1) return;
    }
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
        globalScope.CSS.highlights.set(HIGHLIGHT_KEY, new globalScope.Highlight(range));
      } catch {
        // Ignorar si el DOM mutó externamente
      }
    }
  }

  function clearBlockHighlights() {
    clearSentenceHighlight();
    state.activeIndex = -1;
    var prev = document.querySelectorAll("[" + ACTIVE_ATTR + '="true"]');
    for (var i = 0; i < prev.length; i += 1) {
      prev[i].removeAttribute(ACTIVE_ATTR);
    }
  }

  function highlightActiveBlock(paragraphIndex, sentenceText) {
    ensureStyles();
    clearBlockHighlights();

    var target = state.elements[paragraphIndex] || document.querySelector("[" + BLOCK_ATTR + '="' + paragraphIndex + '"]');
    if (!target) return;

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
  }

  function broadcastState() {
    var payload = getFullStatus();
    if (globalScope.chrome && globalScope.chrome.runtime && globalScope.chrome.runtime.sendMessage) {
      try {
        var p = globalScope.chrome.runtime.sendMessage({
          type: "CHALAVOICE_STATE_UPDATE",
          status: payload
        });
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch {
        // Popup cerrado: ignorar silenciosamente
      }
    }
    updateMinibarUI(payload);
  }

  function getFullStatus() {
    var engineStatus = state.engine
      ? state.engine.getStatus()
      : {
          state: "idle",
          chunkIndex: 0,
          totalChunks: 0,
          paragraphIndex: 0,
          percent: 0,
          currentText: "",
          preset: state.settings.preset,
          rate: state.settings.rate,
          pitch: state.settings.pitch,
          volume: state.settings.volume,
          voiceURI: state.settings.voiceURI,
          sleepActive: false,
          sleepMinutes: 0,
          sleepRemainingMs: 0
        };

    return {
      source: "web",
      title: (state.article && state.article.title) || document.title || "",
      url: globalScope.location ? globalScope.location.href : "",
      lang: (state.article && state.article.lang) || "",
      wordCount: (state.article && state.article.wordCount) || 0,
      readingTimeMinutes: (state.article && state.article.readingTimeMinutes) || 1,
      paragraphCount: state.elements.length,
      inspectorActive: state.inspectorActive,
      state: engineStatus.state,
      chunkIndex: engineStatus.chunkIndex,
      totalChunks: engineStatus.totalChunks,
      paragraphIndex: engineStatus.paragraphIndex,
      percent: engineStatus.percent,
      currentText: engineStatus.currentText,
      preset: state.settings.preset,
      rate: state.settings.rate,
      pitch: state.settings.pitch,
      volume: state.settings.volume,
      voiceURI: state.settings.voiceURI,
      sleepActive: engineStatus.sleepActive,
      sleepMinutes: engineStatus.sleepMinutes,
      sleepRemainingMs: engineStatus.sleepRemainingMs
    };
  }

  function ensureEngine() {
    if (state.engine) return state.engine;
    if (!globalScope.ChalaSpeechQueue) return null;

    state.engine = new globalScope.ChalaSpeechQueue.SpeechQueueEngine({
      rate: state.settings.rate,
      pitch: state.settings.pitch,
      volume: state.settings.volume,
      paragraphPauseMs: state.settings.paragraphPauseMs,
      onChunkStart: function (chunk) {
        highlightActiveBlock(chunk.paragraphIndex, chunk.text);
        broadcastState();
      },
      onStateChange: function (nextState) {
        if (nextState === "idle") {
          clearBlockHighlights();
          destroyMinibar();
          removeStylesIfIdle();
        } else {
          ensureMinibar();
        }
        broadcastState();
      },
      onProgress: function () {
        updateMinibarUI(getFullStatus());
      },
      onSleepTick: function (ev) {
        if (ev && ev.expired) {
          updateMinibarUI(getFullStatus());
        }
        broadcastState();
      },
      onComplete: function () {
        clearBlockHighlights();
        destroyMinibar();
        removeStylesIfIdle();
        broadcastState();
      }
    });

    return state.engine;
  }

  async function syncSettingsAndVoices(sampleText, declaredLang) {
    if (globalScope.chrome && globalScope.chrome.storage && globalScope.chrome.storage.local) {
      try {
        var stored = await globalScope.chrome.storage.local.get(["chalavoice_settings"]);
        if (stored && stored.chalavoice_settings) {
          state.settings = Object.assign({}, state.settings, stored.chalavoice_settings);
        }
      } catch {
        // Ignorar
      }
    }

    var engine = ensureEngine();
    if (!engine) return;

    engine.preset = state.settings.preset || "natural";
    engine.setRate(state.settings.rate);
    engine.setPitch(state.settings.pitch);
    engine.setVolume(state.settings.volume);
    engine.paragraphPauseMs = state.settings.paragraphPauseMs || 500;

    if (globalScope.ChalaVoiceRanker && typeof globalScope.speechSynthesis !== "undefined") {
      if (state.voices.length === 0) {
        state.voices = await globalScope.ChalaVoiceRanker.loadVoices(globalScope.speechSynthesis, 800);
      }
      var lang = globalScope.ChalaVoiceRanker.detectLanguage(sampleText || "", declaredLang || "");
      engine.setLang(lang);
      state.rankedVoices = globalScope.ChalaVoiceRanker.rankVoices(state.voices, lang);

      var chosen = null;
      if (state.settings.voiceURI) {
        for (var i = 0; i < state.rankedVoices.length; i += 1) {
          if (state.rankedVoices[i].voiceURI === state.settings.voiceURI) {
            chosen = state.rankedVoices[i].voice;
            break;
          }
        }
      }
      if (!chosen && state.rankedVoices[0]) {
        chosen = state.rankedVoices[0].voice;
      }
      engine.setVoice(chosen);
    }
  }

  function tagReadableBlocks(extraElement) {
    var old = document.querySelectorAll("[" + BLOCK_ATTR + "]");
    for (var i = 0; i < old.length; i += 1) {
      old[i].removeAttribute(BLOCK_ATTR);
    }

    if (!globalScope.ChalaVoiceReadability) return false;
    var found = globalScope.ChalaVoiceReadability.findReadableElements(document);
    var elements = (found.elements || []).slice();

    // Si el usuario seleccionó en el Inspector un bloque válido que no estaba en la lista heurística, incluirlo ordenadamente
    if (extraElement && elements.indexOf(extraElement) === -1) {
      var extraText = globalScope.ChalaVoiceReadability.normalizeText(extraElement.textContent);
      if (extraText) {
        var collected = collectAllCandidateBlocks(document);
        if (collected.length > elements.length) {
          elements = collected;
        }
        if (elements.indexOf(extraElement) === -1) {
          elements.unshift(extraElement);
        }
      }
    }

    state.elements = elements;
    var blocks = [];
    var textParts = [];
    for (var j = 0; j < elements.length; j += 1) {
      var el = elements[j];
      if (el && typeof el.setAttribute === "function") {
        el.setAttribute(BLOCK_ATTR, String(j));
      }
      var txt = globalScope.ChalaVoiceReadability.normalizeText(el.textContent);
      if (txt) {
        blocks.push({ index: j, tag: String(el.tagName || "P").toUpperCase(), text: txt });
        textParts.push(txt);
      }
    }

    var fullText = textParts.join("\n\n");
    var words = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
    state.article = {
      title: (found.metadata && found.metadata.title) || document.title || "Artículo web",
      lang: (found.metadata && found.metadata.lang) || "",
      blocks: blocks,
      textContent: fullText,
      wordCount: words,
      readingTimeMinutes: globalScope.ChalaVoiceReadability.estimateReadingMinutes(words, 150)
    };
    return elements.length > 0;
  }

  function collectAllCandidateBlocks(doc) {
    if (!doc || !doc.body || !globalScope.ChalaVoiceReadability) return [];
    var all = doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, li, pre");
    var list = [];
    var seen = new Set();
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (isElementInsideOverlay(el)) continue;
      var txt = globalScope.ChalaVoiceReadability.normalizeText(el.textContent);
      if (txt.length < 10 || seen.has(txt)) continue;
      seen.add(txt);
      list.push(el);
    }
    return list;
  }

  function isElementInsideOverlay(node) {
    var cur = node;
    while (cur) {
      if (cur.id === MINIBAR_HOST_ID || cur.id === TOOLTIP_HOST_ID) return true;
      cur = cur.parentNode || cur.host || null;
    }
    return false;
  }

  async function startReadingPage(startParagraphIndex) {
    var startIdx = typeof startParagraphIndex === "number" ? startParagraphIndex : 0;
    tagReadableBlocks(null);
    if (state.elements.length === 0) {
      return { ok: false, reason: "NO_READABLE_CONTENT" };
    }

    await syncSettingsAndVoices(state.article.textContent, state.article.lang);
    var engine = ensureEngine();
    if (!engine) return { ok: false, reason: "NO_ENGINE" };

    var paragraphs = state.article.blocks.map(function (b) { return b.text; });
    engine.loadParagraphs(paragraphs);
    if (startIdx > 0) {
      engine.jumpToParagraph(startIdx);
    }
    ensureMinibar();
    engine.play(engine.currentIndex);
    return { ok: true, status: getFullStatus() };
  }

  // ==================== MINI BARRA FLOTANTE (SHADOW DOM) ====================

  function buildMinibarDom() {
    if (state.minibarHost && document.getElementById(MINIBAR_HOST_ID)) return;
    if (!document.body) return;

    var host = document.createElement("div");
    host.id = MINIBAR_HOST_ID;
    host.style.cssText =
      "position:fixed;bottom:18px;right:18px;z-index:2147483646;font-family:system-ui,-apple-system,sans-serif;";

    var shadow = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    shadow.innerHTML = [
      "<style>",
      ":host{all:initial;}",
      ".bar{display:flex;align-items:center;gap:6px;background:#121216;color:#FFFFFF;border:1px solid #3F3F46;border-radius:999px;padding:6px 10px;box-shadow:0 10px 28px rgba(0,0,0,.55);font-family:system-ui,-apple-system,sans-serif;font-size:12px;user-select:none;position:relative;overflow:hidden;}",
      ".bar.min{padding:6px 10px;}",
      ".bar.min .full-only{display:none;}",
      ".grip{cursor:grab;color:#A1A1AA;padding:2px 4px;font-size:13px;line-height:1;}",
      ".grip:active{cursor:grabbing;}",
      "button{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:#1C1C22;color:#F4F4F5;border:1px solid #2A2A32;font-size:12px;transition:background .15s,border-color .15s;}",
      "button:hover{background:#2A2A32;border-color:#F97316;}",
      "button.play{background:#F97316;color:#FFFFFF;border-color:#F97316;font-weight:700;width:30px;height:30px;}",
      "button.play:hover{background:#EA580C;border-color:#EA580C;}",
      "button.inspect{color:#FB923C;}",
      ".meta{color:#A1A1AA;font-size:11px;padding:0 4px;white-space:nowrap;}",
      ".prog{position:absolute;left:0;bottom:0;height:2px;background:#F97316;width:0%;transition:width .2s;}",
      "</style>",
      '<div class="bar" id="cvBar">',
      '  <span class="grip" id="cvGrip" title="Arrastrar">⋮⋮</span>',
      '  <button id="cvPrev" class="full-only" title="Párrafo anterior">⏮</button>',
      '  <button id="cvPlay" class="play" title="Reproducir / Pausar">⏸</button>',
      '  <button id="cvNext" class="full-only" title="Párrafo siguiente">⏭</button>',
      '  <span class="meta full-only" id="cvMeta">1/1</span>',
      '  <button id="cvInspect" class="inspect full-only" title="Seleccionar párrafo inicial">🎯</button>',
      '  <button id="cvMin" title="Minimizar / Expandir">—</button>',
      '  <button id="cvStop" class="full-only" title="Detener">⏹</button>',
      '  <div class="prog" id="cvProg"></div>',
      "</div>"
    ].join("");

    document.body.appendChild(host);
    state.minibarHost = host;
    state.minibarShadow = shadow;

    if (state.minibarPos) {
      host.style.left = state.minibarPos.left + "px";
      host.style.top = state.minibarPos.top + "px";
      host.style.right = "auto";
      host.style.bottom = "auto";
    }

    var q = function (sel) { return shadow.querySelector("#" + sel); };
    var grip = q("cvGrip");
    if (grip && typeof grip.addEventListener === "function") {
      var dragging = false;
      var offsetX = 0;
      var offsetY = 0;

      grip.addEventListener("pointerdown", function (ev) {
        dragging = true;
        var rect = host.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;
        if (grip.setPointerCapture) grip.setPointerCapture(ev.pointerId);
      });
      grip.addEventListener("pointermove", function (ev) {
        if (!dragging) return;
        var maxX = Math.max(8, (globalScope.innerWidth || 800) - host.offsetWidth - 8);
        var maxY = Math.max(8, (globalScope.innerHeight || 600) - host.offsetHeight - 8);
        var nextLeft = Math.max(8, Math.min(maxX, ev.clientX - offsetX));
        var nextTop = Math.max(8, Math.min(maxY, ev.clientY - offsetY));
        state.minibarPos = { left: nextLeft, top: nextTop };
        host.style.left = nextLeft + "px";
        host.style.top = nextTop + "px";
        host.style.right = "auto";
        host.style.bottom = "auto";
      });
      grip.addEventListener("pointerup", function () {
        dragging = false;
      });
    }

    var bindBtn = function (id, fn) {
      var btn = q(id);
      if (btn && typeof btn.addEventListener === "function") {
        btn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          fn();
        });
      }
    };

    bindBtn("cvPlay", function () {
      if (!state.engine) return;
      if (state.engine.state === "playing") state.engine.pause();
      else state.engine.resume();
    });
    bindBtn("cvPrev", function () {
      if (state.engine) state.engine.prevParagraph();
    });
    bindBtn("cvNext", function () {
      if (state.engine) state.engine.nextParagraph();
    });
    bindBtn("cvStop", function () {
      if (state.engine) state.engine.stop();
    });
    bindBtn("cvInspect", function () {
      startInspector();
    });
    bindBtn("cvMin", function () {
      state.minibarMinimized = !state.minibarMinimized;
      updateMinibarUI(getFullStatus());
    });
  }

  function ensureMinibar() {
    buildMinibarDom();
    updateMinibarUI(getFullStatus());
  }

  function destroyMinibar() {
    if (state.minibarHost && state.minibarHost.parentNode) {
      state.minibarHost.parentNode.removeChild(state.minibarHost);
    }
    state.minibarHost = null;
    state.minibarShadow = null;
  }

  function updateMinibarUI(status) {
    if (!state.minibarShadow) return;
    var bar = state.minibarShadow.querySelector("#cvBar");
    var playBtn = state.minibarShadow.querySelector("#cvPlay");
    var meta = state.minibarShadow.querySelector("#cvMeta");
    var prog = state.minibarShadow.querySelector("#cvProg");
    var minBtn = state.minibarShadow.querySelector("#cvMin");

    if (bar && bar.classList) {
      bar.classList.toggle("min", Boolean(state.minibarMinimized));
    }
    if (playBtn) {
      playBtn.textContent = status.state === "playing" ? "⏸" : "▶";
    }
    if (minBtn) {
      minBtn.textContent = state.minibarMinimized ? "🔊" : "—";
    }
    if (meta) {
      meta.textContent = (status.paragraphIndex + 1) + "/" + Math.max(1, status.paragraphCount);
    }
    if (prog && prog.style) {
      prog.style.width = (status.percent || 0) + "%";
    }
  }

  // ==================== MODO INSPECTOR ("SELECCIONAR PÁRRAFO INICIAL") ====================

  var INSPECTOR_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TD"]);

  function findInspectableBlock(target) {
    var cur = target;
    while (cur && cur.nodeType === 1) {
      if (isElementInsideOverlay(cur)) return null;
      var tag = String(cur.tagName || "").toUpperCase();
      if (tag === "BODY" || tag === "HTML") return null;

      var txt = globalScope.ChalaVoiceReadability
        ? globalScope.ChalaVoiceReadability.normalizeText(cur.textContent)
        : String(cur.textContent || "").trim();

      if (INSPECTOR_TAGS.has(tag) && txt.length >= 4) {
        return cur;
      }
      if (tag === "DIV" && txt.length >= 20 && cur.querySelectorAll) {
        var childBlocks = cur.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, li, pre");
        if (!childBlocks || childBlocks.length === 0) {
          return cur;
        }
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function ensureInspectorTooltip() {
    if (state.tooltipHost && document.getElementById(TOOLTIP_HOST_ID)) return;
    if (!document.body) return;

    var host = document.createElement("div");
    host.id = TOOLTIP_HOST_ID;
    host.style.cssText =
      "position:fixed;top:12px;left:12px;z-index:2147483647;pointer-events:none;display:none;";

    var shadow = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    shadow.innerHTML = [
      "<style>",
      ":host{all:initial;}",
      ".tip{background:#121216;color:#FFFFFF;border:1px solid #F97316;border-radius:8px;padding:6px 10px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:600;box-shadow:0 8px 22px rgba(0,0,0,.6);white-space:nowrap;}",
      ".dot{display:inline-block;width:7px;height:7px;border-radius:999px;background:#F97316;margin-right:6px;}",
      "</style>",
      '<div class="tip"><span class="dot"></span><span id="cvTipText"></span></div>'
    ].join("");

    var span = shadow.querySelector("#cvTipText");
    if (span) {
      span.textContent = msg("inspectorTooltip", "Clic para leer desde aquí · Esc para cancelar");
    }

    document.body.appendChild(host);
    state.tooltipHost = host;
    state.tooltipShadow = shadow;
  }

  function positionInspectorTooltip(targetEl) {
    ensureInspectorTooltip();
    if (!state.tooltipHost || !targetEl) return;
    state.tooltipHost.style.display = "block";
    if (typeof targetEl.getBoundingClientRect === "function") {
      var rect = targetEl.getBoundingClientRect();
      var top = rect.top >= 40 ? rect.top - 36 : Math.min((globalScope.innerHeight || 600) - 42, rect.bottom + 8);
      var left = Math.max(10, Math.min((globalScope.innerWidth || 800) - 310, rect.left));
      state.tooltipHost.style.top = top + "px";
      state.tooltipHost.style.left = left + "px";
    }
  }

  function clearInspectorHover() {
    if (state.hoveredElement) {
      state.hoveredElement.removeAttribute(INSPECT_ATTR);
      state.hoveredElement = null;
    }
    if (state.tooltipHost) {
      state.tooltipHost.style.display = "none";
    }
  }

  function onInspectorMove(event) {
    if (!state.inspectorActive || !event || !event.target) return;
    var candidate = findInspectableBlock(event.target);
    if (!candidate) {
      clearInspectorHover();
      return;
    }
    if (candidate !== state.hoveredElement) {
      if (state.hoveredElement) state.hoveredElement.removeAttribute(INSPECT_ATTR);
      state.hoveredElement = candidate;
      candidate.setAttribute(INSPECT_ATTR, "true");
    }
    positionInspectorTooltip(candidate);
  }

  function onInspectorClick(event) {
    if (!state.inspectorActive || !event) return;
    if (isElementInsideOverlay(event.target)) return;

    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

    var chosen = findInspectableBlock(event.target) || state.hoveredElement;
    stopInspector();

    if (!chosen) return;

    tagReadableBlocks(chosen);
    var startIdx = state.elements.indexOf(chosen);
    if (startIdx < 0) startIdx = 0;

    syncSettingsAndVoices(state.article.textContent, state.article.lang).then(function () {
      var engine = ensureEngine();
      if (!engine || !state.article) return;
      var paragraphs = state.article.blocks.map(function (b) { return b.text; });
      engine.loadParagraphs(paragraphs);
      engine.jumpToParagraph(startIdx);
      ensureMinibar();
      engine.play(engine.currentIndex);
    });
  }

  function onInspectorMouseDown(event) {
    if (!state.inspectorActive || !event) return;
    if (isElementInsideOverlay(event.target)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
  }

  function onInspectorKeyDown(event) {
    if (!state.inspectorActive || !event) return;
    if (event.key === "Escape") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      stopInspector();
      broadcastState();
    }
  }

  function startInspector() {
    if (state.inspectorActive) return getFullStatus();
    ensureStyles();
    ensureInspectorTooltip();
    state.inspectorActive = true;
    document.addEventListener("mousemove", onInspectorMove, true);
    document.addEventListener("mouseover", onInspectorMove, true);
    document.addEventListener("mousedown", onInspectorMouseDown, true);
    document.addEventListener("click", onInspectorClick, true);
    document.addEventListener("keydown", onInspectorKeyDown, true);
    broadcastState();
    return getFullStatus();
  }

  function stopInspector() {
    state.inspectorActive = false;
    clearInspectorHover();
    if (state.tooltipHost && state.tooltipHost.parentNode) {
      state.tooltipHost.parentNode.removeChild(state.tooltipHost);
    }
    state.tooltipHost = null;
    state.tooltipShadow = null;
    document.removeEventListener("mousemove", onInspectorMove, true);
    document.removeEventListener("mouseover", onInspectorMove, true);
    document.removeEventListener("mousedown", onInspectorMouseDown, true);
    document.removeEventListener("click", onInspectorClick, true);
    document.removeEventListener("keydown", onInspectorKeyDown, true);
    removeStylesIfIdle();
  }

  // ==================== MANEJADOR DE COMANDOS DESDE POPUP/BACKGROUND ====================

  async function handleCommand(cmd) {
    var action = cmd && cmd.action;
    switch (action) {
      case "GET_STATE":
        return { ok: true, status: getFullStatus() };

      case "PLAY_PAGE":
        return startReadingPage(typeof cmd.paragraphIndex === "number" ? cmd.paragraphIndex : 0);

      case "PAUSE":
        if (state.engine) state.engine.pause();
        return { ok: true, status: getFullStatus() };

      case "RESUME":
        if (state.engine && state.engine.chunks.length > 0) {
          state.engine.resume();
          return { ok: true, status: getFullStatus() };
        }
        return startReadingPage(0);

      case "TOGGLE_PLAY":
        if (state.engine && state.engine.state === "playing") {
          state.engine.pause();
          return { ok: true, status: getFullStatus() };
        }
        if (state.engine && state.engine.state === "paused") {
          state.engine.resume();
          return { ok: true, status: getFullStatus() };
        }
        return startReadingPage(0);

      case "STOP":
        stopInspector();
        if (state.engine) state.engine.stop();
        clearBlockHighlights();
        destroyMinibar();
        removeStylesIfIdle();
        return { ok: true, status: getFullStatus() };

      case "NEXT_PARA":
        if (state.engine) state.engine.nextParagraph();
        return { ok: true, status: getFullStatus() };

      case "PREV_PARA":
        if (state.engine) state.engine.prevParagraph();
        return { ok: true, status: getFullStatus() };

      case "SEEK_PERCENT": {
        if (state.engine && state.engine.chunks.length > 0) {
          var pct = Math.max(0, Math.min(100, Number(cmd.percent) || 0)) / 100;
          var idx = Math.min(state.engine.chunks.length - 1, Math.floor(pct * state.engine.chunks.length));
          state.engine.jumpToChunk(idx);
        }
        return { ok: true, status: getFullStatus() };
      }

      case "UPDATE_SETTINGS": {
        if (cmd.settings) {
          state.settings = Object.assign({}, state.settings, cmd.settings);
          var eng = ensureEngine();
          if (eng) {
            if (cmd.settings.preset && globalScope.ChalaSpeechQueue.VOICE_PRESETS[cmd.settings.preset]) {
              eng.applyPreset(cmd.settings.preset);
            }
            if (cmd.settings.rate !== undefined) eng.setRate(cmd.settings.rate);
            if (cmd.settings.pitch !== undefined) eng.setPitch(cmd.settings.pitch);
            if (cmd.settings.volume !== undefined) eng.setVolume(cmd.settings.volume);
            if (cmd.settings.paragraphPauseMs !== undefined) eng.paragraphPauseMs = cmd.settings.paragraphPauseMs;
            if (cmd.settings.voiceURI !== undefined && state.rankedVoices.length > 0) {
              var foundVoice = state.rankedVoices.find(function (v) { return v.voiceURI === cmd.settings.voiceURI; });
              if (foundVoice) eng.setVoice(foundVoice.voice);
            }
          }
        }
        if (cmd.sleepMinutes !== undefined) {
          var engSleep = ensureEngine();
          if (engSleep) engSleep.setSleepTimer(Number(cmd.sleepMinutes) || 0);
        }
        broadcastState();
        return { ok: true, status: getFullStatus() };
      }

      case "START_INSPECTOR":
        return { ok: true, status: startInspector() };

      case "CANCEL_INSPECTOR":
        stopInspector();
        return { ok: true, status: getFullStatus() };

      default:
        return { ok: false, reason: "UNKNOWN_ACTION" };
    }
  }

  if (globalScope.chrome && globalScope.chrome.runtime && globalScope.chrome.runtime.onMessage && globalScope.chrome.runtime.onMessage.addListener) {
    globalScope.chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || typeof message.type !== "string") return false;
      if (message.type === "CHALAVOICE_PING") {
        sendResponse({ alive: true, status: getFullStatus() });
        return false;
      }
      if (message.type === "CHALAVOICE_CMD") {
        handleCommand(message).then(sendResponse, function (err) {
          sendResponse({ ok: false, error: err && err.message ? err.message : "CMD_ERROR" });
        });
        return true;
      }
      return false;
    });
  }

  globalScope.ChalaVoiceHighlighter = {
    handleCommand: handleCommand,
    startInspector: startInspector,
    stopInspector: stopInspector,
    startReadingPage: startReadingPage,
    getStatus: getFullStatus,
    onInspectorMove: onInspectorMove,
    onInspectorClick: onInspectorClick,
    onInspectorKeyDown: onInspectorKeyDown
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
