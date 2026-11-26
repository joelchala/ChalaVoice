# ChalaVoice — Ficha para Mozilla Firefox Add-ons (AMO)

Material listo para **addons.mozilla.org (AMO)**.

## 1. Paquete específico para Firefox

- **Archivo:** `store/paquetes/ChalaVoice_1.0.0.firefox.zip`
- **Transformaciones automáticas aplicadas por `tools/make-mv3.mjs`:**
  - `browser_specific_settings.gecko.id`: `chalavoice@chaladev.site`
  - `browser_specific_settings.gecko.strict_min_version`: `113.0`
  - `browser_specific_settings.gecko.data_collection_permissions.required`: `["none"]`
  - `background.scripts`: `["background.js"]` (reemplaza `service_worker`)
  - `sidebar_action`: `{ "default_panel": "sidepanel/index.html", "default_title": "ChalaVoice", "default_icon": ... }` (reemplaza `side_panel` y elimina el permiso `"sidePanel"`)

## 2. Notas para el revisor de AMO

```
ChalaVoice is built from pure JavaScript (zero third-party dependencies, zero bundlers, zero minified or obfuscated code).
All files inside src/ are copied verbatim into the XPI/ZIP package, with only manifest.json adapted for Firefox MV3 sidebar_action and background.scripts.
No external network requests are performed; EPUB files are parsed locally via DecompressionStream('deflate-raw') and DOMParser, and speech synthesis uses the browser's built-in Web Speech API.
```

## 3. Categorías y metadatos sugeridos

- **Categorías:** Appearance / Other / Productivity
- **Licencia:** MIT
- **Sitio web:** `https://chaladev.site`
- **Código fuente:** `https://github.com/joelchala/ChalaVoice`
- **Política de privacidad:** `https://github.com/joelchala/ChalaVoice/blob/main/PRIVACY.md`
