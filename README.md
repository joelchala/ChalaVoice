<h1 align="center">
<img src="src/icons/icon.svg" height="52" width="52" alt="">
<br>
ChalaVoice
</h1>

<p align="center">
Lector en voz alta 100% local y privado (Manifest V3) para Google Chrome, Microsoft Edge y Mozilla Firefox.<br>
Popup compacto, Mini Barra Flotante en Shadow DOM, Modo Inspector visual, motor anti-congelamiento de 3 capas y lector offline (<code>.epub</code>, <code>.md</code>, <code>.txt</code>).
</p>

***

## Qué es

**ChalaVoice** convierte artículos web, apuntes y libros digitales en audio nítido utilizando exclusivamente las voces nativas de tu sistema operativo y navegador (`Web Speech API`), **100% offline**, sin servidores externos, sin telemetría y con **cero dependencias externas**.

- **Sitio oficial (Suite Chala):** [chaladev.site](https://chaladev.site/)
- **Autor y mantenimiento:** Joel Rafael Chala García / Coposys SRL ([info@chaladev.site](mailto:info@chaladev.site))
- **Licencia:** [MIT](LICENSE.txt)
- **Privacidad:** [no recopila ni transmite datos](PRIVACY.md)

## Compatibilidad y Novedades en v1.1.0

- **Compatibilidad ampliada:** al migrar de `sidePanel` / `sidebar_action` a `action.default_popup` estándar, ChalaVoice **v1.1.0** es compatible con **Google Chrome >= 109**, **Microsoft Edge >= 109**, navegadores basados en Chromium (Brave, Vivaldi, Opera) y **Mozilla Firefox >= 113**, manteniendo **Node.js >= 22** para compilación y cero dependencias externas.
- **Novedades en v1.1.0:**
  - Popup compacto de `360px` (`src/popup/`) con sincronización en tiempo real.
  - Audio persistente dentro de la pestaña activa al cerrar el Popup + Lector dedicado de Libros (`src/reader/`) para `.epub`, `.md`, `.txt` y texto pegado.
  - Mini Barra Flotante arrastrable aislada en Shadow DOM (`#chalavoice-minibar-host`).
  - Modo Inspector (*"Seleccionar párrafo inicial"*) con recuadro naranja (`#F97316`), bloqueo de enlaces y cancelación con `Esc`.
  - Paleta de alto contraste Negro, Gris, Naranja y Blanco (`#0B0B0E`, `#1C1C22`, `#F97316`, `#FFFFFF`) y logotipo renovado de parlante + micrófono con ondas naranjas.

## Características principales

- **Popup compacto (`360px`) + Audio Persistente:** al cerrar el Popup la lectura no se interrumpe porque el motor de síntesis corre dentro de la pestaña activa (para artículos web) o en la pestaña dedicada `reader/index.html` (para libros locales).
- **Mini Barra Flotante discreta (Shadow DOM):** píldora flotante arrastrable y minimizable en la página con controles rápidos (Play/Pausa, Anterior, Siguiente, Modo Inspector y Detener).
- **Modo Inspector ("Seleccionar párrafo inicial"):** activa un selector visual tipo DevTools con recuadro naranja (`#F97316`), bloquea clics accidentales en enlaces y comienza a leer exactamente desde el párrafo, encabezado o lista donde hagas clic (`Esc` para cancelar).
- **Motor Anti-Congelamiento de 3 capas (`src/lib/speech-queue.js`):**
  1. *Subdivisión inteligente:* divide párrafos en oraciones respetando abreviaturas (`Sr.`, `Dr.`, `etc.`) y subdivide frases largas (`>200` caracteres) en comas o espacios para evitar cortes a los 15 segundos en Chromium.
  2. *Pausas naturales diferenciadas:* evita llamar a `speechSynthesis.cancel()` entre chunks consecutivos normales y aplica pausas cortas entre oraciones y pausas largas entre párrafos.
  3. *Blindaje GC + Watchdog:* retiene `activeUtterance` contra el Garbage Collector y recupera automáticamente la cola si el motor nativo se congela.
- **Perfiles de voz multiplataforma (`src/lib/voice-ranker.js`):** detecta el idioma del texto y ordena voces `Natural`, `Neural`, `Online`, `Google` y `Apple`, más 4 presets en un clic (**Narrador Rústico**, **Voz Suave**, **Modo Estudio**, **Natural**) y **Sleep Timer** con atenuación gradual.
- **Lector de Libros y Textos (`src/reader/` + `src/lib/book-parser.js`):** carga drag-and-drop de **`.epub`** (PKZIP + `DecompressionStream('deflate-raw')` + `DOMParser` nativos), **`.md`**, **`.txt`** y texto pegado, guardando tu progreso exacto en `chrome.storage.local`.

## Instalación

1. Descarga el paquete para tu navegador desde [GitHub Releases](https://github.com/joelchala/ChalaVoice/releases) o compílalo localmente.
2. **Chrome / Edge:** abre `chrome://extensions` o `edge://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona `dist/build/ChalaVoice.chromium/`.
3. **Firefox (carga temporal):** abre `about:debugging#/runtime/this-firefox`, pulsa **Cargar complemento temporal…** y elige `store/paquetes/ChalaVoice_1.1.0.firefox.zip`.

## Compilar, generar iconos y probar

Requisitos: **Node.js >= 22** (cero dependencias externas).

```bash
git clone https://github.com/joelchala/ChalaVoice.git
cd ChalaVoice
npm run icons
npm run build
npm test
```

Los paquetes listos para tienda se generan en `store/paquetes/` (con copia en `dist/build/`):

- `ChalaVoice_1.1.0.chromium.zip` — Chrome Web Store
- `ChalaVoice_1.1.0.edge.zip` — Microsoft Edge Add-ons
- `ChalaVoice_1.1.0.firefox.zip` — Mozilla Firefox Add-ons / AMO (`gecko.id = "chalavoice@chaladev.site"`, `strict_min_version: "113.0"`, `background.scripts` y `action.default_popup`)

## Suite Chala (las 8 extensiones)

**ChalaVoice** forma parte de la **Suite Chala** ([chaladev.site](https://chaladev.site/)):

- **[Chalablock](https://github.com/joelchala/Chalablock)** — Bloqueador de anuncios y rastreadores ligero (Manifest V3)
- **[ChalaCookiesEdit](https://github.com/joelchala/ChalaCookiesEdit)** — Editor de cookies local con soporte CHIPS, incógnito, bloqueo e inspector JWT
- **[ChalaDev](https://github.com/joelchala/ChalaDev)** — Suite de utilidades locales para desarrolladores y diseñadores UI/UX
- **[ChalaReader](https://github.com/joelchala/ChalaReader)** — Modo lectura limpio con Shadow DOM, temas visuales, Markdown, PDF y guardado offline
- **[ChalaScrape](https://github.com/joelchala/ChalaScrape)** — Extractor visual de tablas, listas y tarjetas web a Excel (`.xlsx`) y CSV
- **[ChalaTabs](https://github.com/joelchala/ChalaTabs)** — Gestor de pestañas en espacios de trabajo, ahorro de RAM y buscador instantáneo
- **[ChalaVoice](https://github.com/joelchala/ChalaVoice)** — Lector en voz alta 100% local con Popup, Mini Barra Flotante, Modo Inspector y modo libro (EPUB/MD/TXT)
- **[ChalaVPN](https://github.com/joelchala/ChalaVPN)** — Proxy HTTPS/SOCKS5 con protección contra fugas de WebRTC

## Apoyar el proyecto

ChalaVoice es 100% gratuito y de código abierto bajo [Licencia MIT](LICENSE.txt). Si te resulta útil, puedes realizar una [donación opcional por PayPal](https://www.paypal.com/ncp/payment/VSWPSS7D4ZRH2). Donar no desbloquea ninguna función.
