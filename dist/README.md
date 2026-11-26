# Guía de Instalación Local (`dist/`)

## Google Chrome / Microsoft Edge (carga descomprimida)

1. Genera la compilación ejecutando:
   ```bash
   npm run build
   ```
   (o descarga `ChalaVoice_<version>.chromium.zip` / `ChalaVoice_<version>.edge.zip` desde GitHub Releases y descomprímelo).
2. Abre `chrome://extensions/` en Chrome o `edge://extensions/` en Microsoft Edge.
3. Activa el **Modo de desarrollador**.
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta `dist/build/ChalaVoice.chromium/`.

## Actualización manual conservando biblioteca local

- Mantén la extensión cargada desde la misma ruta local y reemplaza el contenido de la carpeta cuando actualices para conservar tus libros guardados, progreso de lectura y ajustes de voz en `chrome.storage.local`.

## Mozilla Firefox (carga temporal)

1. Abre `about:debugging#/runtime/this-firefox`.
2. Haz clic en **Cargar complemento temporal…** y selecciona `store/paquetes/ChalaVoice_1.0.0.firefox.zip`.
