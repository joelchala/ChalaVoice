# ChalaVoice — Ficha para Chrome Web Store

Material listo para **Chrome Web Store Developer Dashboard**.

## 1. Paquete

- **Archivo:** `store/paquetes/ChalaVoice_1.1.0.chromium.zip`

## 2. Propósito Único (Single Purpose)

> ChalaVoice reads web articles and local books (.epub, .md, .txt) aloud completely offline using native browser speech synthesis, a compact Popup, a draggable Shadow DOM Floating Mini-Bar, visual Inspector start-point selection, voice profiles, and a sleep timer.

## 3. Justificación de permisos

- **`activeTab`**: Acceso temporal a la pestaña activa únicamente cuando el usuario pulsa «Leer página actual» o «Seleccionar párrafo inicial».
- **`scripting`**: Inyección bajo demanda de `lib/readability.js`, `lib/voice-ranker.js`, `lib/speech-queue.js` y `content/highlighter.js` para extraer texto limpio, ejecutar lectura persistente, mostrar la Mini Barra Flotante y activar el Modo Inspector.
- **`storage`**: Almacenamiento local de preferencias de voz, biblioteca offline y progreso de lectura en `chrome.storage.local`.

## 4. Declaración de privacidad y código remoto

- **¿Utiliza código remoto?** No. Todo el código (incluyendo lector PKZIP/EPUB y motor de extracción) está incluido en el ZIP.
- **¿Recopila datos de usuario?** No. Cero analíticas, cero telemetría, cero envíos de red.
- **Política de privacidad:** `https://github.com/joelchala/ChalaVoice/blob/main/PRIVACY.md`

## 5. Descripción corta y larga

- **Descripción corta (`_locales/es`):** `Lector en voz alta 100% local con perfiles de voz, libros EPUB/MD/TXT, resaltado en vivo y temporizador. Cero rastreadores.` (123 caracteres)
- **Short description (`_locales/en`):** `100% local text-to-speech reader with voice profiles, EPUB/MD/TXT book mode, live highlighting & sleep timer. Zero tracking.` (124 caracteres)
