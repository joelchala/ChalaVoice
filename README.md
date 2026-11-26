<h1 align="center">
<img src="src/icons/icon.svg" height="52" width="52" alt="">
<br>
ChalaVoice
</h1>

<p align="center">
Lector en voz alta 100% local y privado (Manifest V3) para Google Chrome, Microsoft Edge y Mozilla Firefox.<br>
Motor anti-congelamiento de 3 capas, perfiles acústicos de voz, modo libro (<code>.epub</code>, <code>.md</code>, <code>.txt</code>), resaltado en vivo y Sleep Timer sin rastreadores.
</p>

***

## Qué es

**ChalaVoice** convierte artículos web, apuntes y libros digitales en audio nítido utilizando exclusivamente las voces nativas de tu sistema operativo y navegador (`Web Speech API`), **100% offline**, sin servidores externos, sin telemetría y con **cero dependencias externas**.

- **Sitio oficial (Suite Chala):** [chaladev.site](https://chaladev.site/)
- **Autor y mantenimiento:** Joel Rafael Chala García / Coposys SRL ([info@chaladev.site](mailto:info@chaladev.site))
- **Licencia:** [MIT](LICENSE.txt)
- **Privacidad:** [no recopila ni transmite datos](PRIVACY.md)

## Características principales

- **Motor Anti-Congelamiento de 3 capas (`src/lib/speech-queue.js`):**
  1. *Subdivisión inteligente:* divide párrafos en oraciones respetando abreviaturas (`Sr.`, `Dr.`, `etc.`) y subdivide frases largas (>200 caracteres) en comas o espacios (~180–220 caracteres) para no superar el límite de 15 segundos de Chromium.
  2. *Pausas naturales diferenciadas:* evita llamar a `speechSynthesis.cancel()` entre chunks consecutivos normales (cero chasquidos) y aplica pausas cortas entre oraciones (~120 ms) y pausas largas entre párrafos (500–700 ms).
  3. *Blindaje GC + Watchdog:* retiene `activeUtterance` contra el Garbage Collector y ejecuta un Watchdog automático basado en `(palabras / (150 * rate)) * 60000 + 6000 ms` para recuperar la cola si el motor nativo se congela.
- **Perfiles de voz multiplataforma (`src/lib/voice-ranker.js`):** detecta el idioma del texto y ordena voces de Windows, macOS, Linux y ChromeOS priorizando `Natural`, `Neural`, `Online`, `Google` y `Apple`, más 4 presets en un clic (**Narrador Rústico**, **Voz Suave**, **Modo Estudio**, **Natural**) y sliders de velocidad (`0.6x–2.0x`), tono (`0.6–1.4`) y volumen.
- **Modo Página Web con resaltado en vivo (`src/content/highlighter.js`):** extrae el artículo limpio con `readability.js`, resalta el párrafo y la oración activa con auto-scroll suave y permite hacer clic en cualquier párrafo de la página para saltar.
- **Modo Libros y Textos (`src/lib/book-parser.js`):** lector local drag-and-drop de **`.epub`** (PKZIP + `DecompressionStream('deflate-raw')` + `DOMParser` nativos), **`.md`**, **`.txt`** y texto pegado, guardando el progreso exacto (`chapterIndex`, `paragraphIndex`, `chunkIndex`) en `chrome.storage.local`.
- **Temporizador de Apagado (Sleep Timer):** opciones `Off`, `15`, `30`, `45` y `60 min` con atenuación gradual del volumen antes de pausar.

## Instalación

1. Descarga el paquete para tu navegador desde [GitHub Releases](https://github.com/joelchala/ChalaVoice/releases) o compílalo localmente (ver abajo).
2. **Chrome / Edge:** abre `chrome://extensions` o `edge://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona `dist/build/ChalaVoice.chromium/`.
3. **Firefox (carga temporal):** abre `about:debugging#/runtime/this-firefox`, pulsa **Cargar complemento temporal…** y elige `store/paquetes/ChalaVoice_1.0.0.firefox.zip`.

## Compilar, generar iconos y probar

Requisitos: **Node.js >= 22** (cero dependencias externas).

```bash
git clone https://github.com/joelchala/ChalaVoice.git
cd ChalaVoice
npm run icons
npm run build
npm test
```

También puedes usar los scripts Bash en `tools/`:

```bash
bash tools/make-mv3.sh
bash tools/make-clean.sh
```

Los paquetes listos para tienda se generan en `store/paquetes/` (con copia en `dist/build/`):

- `ChalaVoice_1.0.0.chromium.zip` — Chrome Web Store
- `ChalaVoice_1.0.0.edge.zip` — Microsoft Edge Add-ons
- `ChalaVoice_1.0.0.firefox.zip` — Mozilla Firefox Add-ons / AMO (`gecko.id = "chalavoice@chaladev.site"`, `strict_min_version: "113.0"`, `background.scripts` y `sidebar_action`)

## Suite Chala (las 8 extensiones)

**ChalaVoice** forma parte de la **Suite Chala** ([chaladev.site](https://chaladev.site/)) de herramientas de navegador 100% locales, de código abierto y orientadas a privacidad y productividad:

- **[Chalablock](https://github.com/joelchala/Chalablock)** — Bloqueador de anuncios y rastreadores ligero (Manifest V3)
- **[ChalaCookiesEdit](https://github.com/joelchala/ChalaCookiesEdit)** — Editor de cookies local con soporte CHIPS, incógnito, bloqueo e inspector JWT
- **[ChalaDev](https://github.com/joelchala/ChalaDev)** — Suite de utilidades locales en el Side Panel para desarrolladores y diseñadores UI/UX
- **[ChalaReader](https://github.com/joelchala/ChalaReader)** — Modo lectura limpio con Shadow DOM, temas visuales, Markdown, PDF y guardado offline
- **[ChalaScrape](https://github.com/joelchala/ChalaScrape)** — Extractor visual de tablas, listas y tarjetas web a Excel (`.xlsx`) y CSV
- **[ChalaTabs](https://github.com/joelchala/ChalaTabs)** — Gestor de pestañas en espacios de trabajo, ahorro de RAM y buscador instantáneo
- **[ChalaVoice](https://github.com/joelchala/ChalaVoice)** — Lector en voz alta 100% local con perfiles de voz, modo libro (EPUB/MD/TXT) y resaltado en vivo
- **[ChalaVPN](https://github.com/joelchala/ChalaVPN)** — Proxy HTTPS/SOCKS5 con protección contra fugas de WebRTC

## Apoyar el proyecto

ChalaVoice es 100% gratuito y de código abierto bajo [Licencia MIT](LICENSE.txt). Si te resulta útil, puedes realizar una [donación opcional por PayPal](https://www.paypal.com/ncp/payment/VSWPSS7D4ZRH2). Donar no desbloquea ninguna función.
