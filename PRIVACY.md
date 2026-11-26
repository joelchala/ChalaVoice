# Política de Privacidad de ChalaVoice

*Última actualización: 25 de noviembre de 2026* · [English version below](#chalavoice-privacy-policy)

ChalaVoice es una extensión de navegador de código abierto (Manifest V3) diseñada para leer artículos web y documentos locales en voz alta de forma 100% offline. Publicada por Joel Rafael Chala García / Coposys SRL bajo licencia MIT.

## Resumen

**ChalaVoice no recopila, almacena en servidores propios, vende ni transmite ningún dato personal ni historial de navegación.** No incluye telemetría, rastreadores, analíticas ni cuentas de usuario.

## Qué datos se procesan y dónde

- **Preferencias de voz y reproducción** (perfil acústico, velocidad, tono, volumen y voz seleccionada): se guardan exclusivamente de forma local mediante `chrome.storage.local`.
- **Biblioteca local de libros y textos** (`.epub`, `.md`, `.txt` y textos pegados, junto con su capítulo, párrafo y posición de lectura): se procesan localmente en tu navegador usando Web APIs nativas (`DecompressionStream`, `DOMParser` y `speechSynthesis`) y se guardan solo en tu dispositivo mediante `chrome.storage.local`.
- **Artículos web leídos:** cuando pulsas *"Leer página actual"*, el contenido legible se extrae localmente en la pestaña activa y nunca sale de tu equipo.

## Conexiones de red

En uso normal, ChalaVoice **no realiza ninguna petición de red**. Las únicas conexiones externas ocurren si haces clic voluntariamente en los enlaces del pie del panel (Suite Chala, repositorio en GitHub o donación opcional en PayPal), donde aplican las políticas de privacidad de dichos sitios.

## Permisos que solicita la extensión

| Permiso | Propósito estricto |
|---|---|
| `sidePanel` | Mostrar la interfaz del reproductor y biblioteca en el panel lateral nativo del navegador (`sidebarAction` en Firefox) |
| `activeTab` | Acceder temporalmente al contenido de la pestaña activa únicamente cuando pulsas el icono o *"Leer página actual"* |
| `scripting` | Inyectar bajo demanda el extractor local (`lib/readability.js`) y el resaltador en vivo (`content/highlighter.js`) |
| `storage` | Guardar tus perfiles de voz, biblioteca local y progreso exacto de lectura en `chrome.storage.local` |

ChalaVoice **no** solicita `<all_urls>`, `host_permissions`, `tabs` ni ejecución de código remoto.

## Contacto

- Sitio web: <https://chaladev.site>
- Repositorio e incidencias: <https://github.com/joelchala/ChalaVoice/issues>
- Correo: <mailto:info@chaladev.site>

---

# ChalaVoice Privacy Policy

*Last updated: November 25, 2026*

ChalaVoice is an open-source Manifest V3 browser extension for 100% offline text-to-speech reading of web articles and local books. Published by Joel Rafael Chala García / Coposys SRL under the MIT license.

## Summary

**ChalaVoice does not collect, transmit, sell, or share any personal or browsing data.** It includes no analytics, no telemetry, no remote servers, and requires no user account.

## What data is handled and where

- **Voice & playback preferences** (preset, rate, pitch, volume, and selected voice): stored solely on your device in `chrome.storage.local`.
- **Local books & texts library** (`.epub`, `.md`, `.txt`, and pasted texts along with exact chapter, paragraph, and chunk progress): parsed completely offline using native browser APIs (`DecompressionStream`, `DOMParser`, and `speechSynthesis`) and stored only in `chrome.storage.local`.
- **Web articles:** extracted locally in the active tab only upon your explicit action without sending URLs or page content anywhere.

## Network connections

In normal operation, ChalaVoice **makes zero network requests**. External connections only occur if you explicitly click footer links (Suite Chala, GitHub, or optional PayPal donation).

## Permissions requested

| Permission | Strict Purpose |
|---|---|
| `sidePanel` | Renders the player and local library inside the browser's native Side Panel (`sidebarAction` on Firefox) |
| `activeTab` | Grants temporary access to the active tab solely when you open the panel or click "Read current page" |
| `scripting` | Injects the local readability extractor (`lib/readability.js`) and live highlighter (`content/highlighter.js`) on demand |
| `storage` | Persists voice settings, local books, and exact reading progress in `chrome.storage.local` |

ChalaVoice does **not** request `<all_urls>`, `host_permissions`, `tabs`, or remote code execution.

## Contact

- Website: <https://chaladev.site>
- Repository & Issues: <https://github.com/joelchala/ChalaVoice/issues>
- Email: <mailto:info@chaladev.site>
