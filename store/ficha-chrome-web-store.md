# ChalaVoice — Ficha para Chrome Web Store

Material listo para **Chrome Web Store Developer Dashboard**.

## 1. Paquete

- **Archivo:** `store/paquetes/ChalaVoice_1.0.0.chromium.zip`

## 2. Propósito Único (Single Purpose)

> ChalaVoice reads web articles and local books (.epub, .md, .txt) aloud completely offline using native browser speech synthesis, live paragraph highlighting, voice profiles, and a sleep timer.

## 3. Justificación de permisos

- **`sidePanel`**: Muestra el reproductor, perfiles de voz y biblioteca local en el Panel Lateral nativo de Chrome manteniendo visible la página para el resaltado en vivo.
- **`activeTab`**: Acceso temporal a la pestaña activa únicamente cuando el usuario abre ChalaVoice o pulsa «Leer página actual».
- **`scripting`**: Inyección bajo demanda de `lib/readability.js` y `content/highlighter.js` para extraer el texto limpio y resaltar la lectura en vivo.
- **`storage`**: Almacenamiento local de preferencias de voz, biblioteca offline y progreso de lectura en `chrome.storage.local`.

## 4. Declaración de privacidad y código remoto

- **¿Utiliza código remoto?** No. Todo el código (incluyendo lector PKZIP/EPUB y motor de extracción) está incluido en el ZIP.
- **¿Recopila datos de usuario?** No. Cero analíticas, cero telemetría, cero envíos de red.
- **Política de privacidad:** `https://github.com/joelchala/ChalaVoice/blob/main/PRIVACY.md`

## 5. Descripción corta y larga

- **Descripción corta (`_locales/es`):** `Lector en voz alta 100% local con perfiles de voz, libros EPUB/MD/TXT, resaltado en vivo y temporizador. Cero rastreadores.` (123 caracteres)
- **Short description (`_locales/en`):** `100% local text-to-speech reader with voice profiles, EPUB/MD/TXT book mode, live highlighting & sleep timer. Zero tracking.` (124 caracteres)
