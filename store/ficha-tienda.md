# ChalaVoice — Ficha para Microsoft Edge Add-ons

Material listo para **Microsoft Partner Center (Edge Add-ons)**.

## 1. Paquete

- **Archivo:** `store/paquetes/ChalaVoice_1.0.0.edge.zip`
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
| `sidePanel` | Displays the ChalaVoice audio player, voice studio, and offline book library inside the browser's native Side Panel while keeping the active webpage visible for live paragraph highlighting. |
| `activeTab` | Grants temporary access to the active tab only when the user clicks the ChalaVoice toolbar icon or "Read current page" to extract readable text locally. |
| `scripting` | Injects the local heuristic readability extractor (`lib/readability.js`) and live sentence highlighter (`content/highlighter.js`) on demand into the active tab. |
| `storage` | Saves voice preferences, acoustic presets, local imported books (`.epub`, `.md`, `.txt`), and exact reading progress in `chrome.storage.local`. |

- **Remote code:** No. Todo el código reside dentro del paquete.
- **Data collection:** None. No recopila ni transmite datos del usuario.

## 4. Descripción en Español

```
ChalaVoice es un lector en voz alta 100% local, privado y de código abierto (Manifest V3) de la Suite Chala.

CARACTERÍSTICAS
• Motor anti-congelamiento de 3 capas: subdivisión segura de oraciones largas, pausas naturales diferenciadas entre oraciones y párrafos, y Watchdog automático frente a cortes de síntesis en Chromium.
• Resaltado en vivo en la página web: extrae el artículo limpio sin anuncios, resalta el párrafo y la oración actual con desplazamiento suave y permite hacer clic en cualquier párrafo para saltar.
• Modo Libros y Textos offline: arrastra archivos .epub, .md o .txt (o pega texto) y retoma exactamente donde lo dejaste gracias al guardado en chrome.storage.local.
• Estudio de Voz: clasifica automáticamente las voces de tu sistema (Natural, Neural, Online, Google, Apple), ofrece 4 presets en un clic (Narrador Rústico, Voz Suave, Modo Estudio, Natural) y controles de velocidad, tono y volumen.
• Temporizador de Apagado (Sleep Timer): 15, 30, 45 o 60 minutos con reducción gradual de volumen antes de pausar.

100% local, sin telemetría, sin servidores externos y bajo licencia MIT.
```

## 5. Notes for Certification

```
ChalaVoice is a 100% offline, open-source (MIT) Manifest V3 text-to-speech reader. No login or credentials are required.
1. Open any article webpage and click the ChalaVoice toolbar icon to open the Side Panel.
2. Click "Leer página actual" / "Read current page" to extract the article and start speech playback with live highlighting.
3. Click any paragraph on the webpage to jump playback, or switch to the "Libros y Textos" tab to load a local .epub, .md, or .txt file.
```
