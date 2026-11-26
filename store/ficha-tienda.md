# ChalaVoice — Ficha para Microsoft Edge Add-ons

Material listo para **Microsoft Partner Center (Edge Add-ons)**.

## 1. Paquete

- **Archivo:** `store/paquetes/ChalaVoice_1.1.0.edge.zip`
- **Generación:** `npm run build` (o descarga en GitHub Releases)

## 2. Propiedades y Disponibilidad

- **Visibility:** Public
- **Category:** Accessibility / Productivity
- **Privacy policy URL:** `https://github.com/joelchala/ChalaVoice/blob/main/PRIVACY.md`
- **Website URL:** `https://chaladev.site`
- **Support contact:** `https://github.com/joelchala/ChalaVoice/issues`
- **Mature content:** No

## 3. Justificación de permisos

| Permiso | Justificación (pegar en Partner Center) |
|---|---|
| `activeTab` | Grants temporary access to the active tab solely when the user clicks "Read current page" or "Select starting paragraph" in the Popup to extract readable text locally. |
| `scripting` | Injects the local heuristic readability extractor (`lib/readability.js`), local speech engine (`lib/voice-ranker.js`, `lib/speech-queue.js`), and live highlighter / Floating Mini-Bar (`content/highlighter.js`) on demand into the active tab. |
| `storage` | Saves voice preferences, acoustic presets, local imported books (`.epub`, `.md`, `.txt`), and exact reading progress in `chrome.storage.local`. |

- **Remote code:** No. Todo el código reside dentro del paquete.
- **Data collection:** None. No recopila ni transmite datos del usuario.

## 4. Descripción en Español

```
ChalaVoice es un lector en voz alta 100% local, privado y de código abierto (Manifest V3) de la Suite Chala.

CARACTERÍSTICAS
• Popup compacto con audio persistente y Mini Barra Flotante arrastrable aislada en Shadow DOM: la lectura continúa aunque cierres el Popup.
• Modo Inspector ("Seleccionar párrafo inicial"): señala cualquier párrafo, título o lista y haz clic para leer exactamente desde ese punto (Esc para cancelar).
• Motor anti-congelamiento de 3 capas: subdivisión segura de oraciones largas, pausas naturales diferenciadas entre oraciones y párrafos, y Watchdog automático frente a cortes de síntesis en Chromium.
• Lector dedicado de Libros y Textos offline: arrastra archivos .epub, .md o .txt (o pega texto) y retoma exactamente donde lo dejaste gracias a chrome.storage.local.
• Estudio de Voz: clasifica automáticamente las voces de tu sistema (Natural, Neural, Online, Google, Apple), ofrece 4 presets en un clic (Narrador Rústico, Voz Suave, Modo Estudio, Natural) y Sleep Timer con atenuación gradual.

100% local, sin telemetría, sin servidores externos y bajo licencia MIT.
```

## 5. Notes for Certification

```
ChalaVoice is a 100% offline, open-source (MIT) Manifest V3 text-to-speech reader. No login or credentials are required.
1. Open any article webpage and click the ChalaVoice toolbar icon to open the compact Popup.
2. Click "Leer página actual" / "Read current page" to start persistent reading with the draggable Shadow DOM Floating Mini-Bar, or click "Seleccionar párrafo inicial" / "Select starting paragraph" to select any paragraph on the page via Inspector Mode.
3. Switch to "Libros y Textos" / "Books & Texts" to open the dedicated offline book reader for .epub, .md, and .txt files.
```
