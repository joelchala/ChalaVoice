# Especificación de Activos Gráficos (`store/`)

Todos los activos PNG se generan de forma determinista y sin dependencias externas ejecutando:

```bash
npm run icons
npm run store-assets
```

- `npm run icons`: genera `src/icons/icon*.png` y `store/logo-300x300.png` (conservando las piezas promocionales y capturas ricas de `store/` si ya existen).
- `npm run store-assets`: renderiza en alta nitidez las 5 piezas promocionales y capturas de interfaz (`promo-440x280.png`, `destacada-1400x560.png`, `captura-1-lector-web.png`, `captura-2-perfiles-voz.png`, `captura-3-biblioteca-epub.png`).

## Inventario y Dimensiones Oficiales

| Archivo | Dimensiones (px) | Uso en Tiendas |
|---|---|---|
| `store/logo-300x300.png` | `300 × 300` | Logo principal en Microsoft Edge Add-ons y AMO |
| `store/promo-440x280.png` | `440 × 280` | Mosaico promocional pequeño (Chrome Web Store / Edge) |
| `store/destacada-1400x560.png` | `1400 × 560` | Banner destacado / Marquee promotional tile |
| `store/captura-1-lector-web.png` | `1280 × 800` | Captura 1: Lector web con resaltado en vivo |
| `store/captura-2-perfiles-voz.png` | `1280 × 800` | Captura 2: Estudio de voz y presets acústicos |
| `store/captura-3-biblioteca-epub.png` | `1280 × 800` | Captura 3: Biblioteca local EPUB / MD / TXT |
| `src/icons/icon16.png` | `16 × 16` | Icono de barra de herramientas |
| `src/icons/icon32.png` | `32 × 32` | Icono de popup y alta densidad |
| `src/icons/icon48.png` | `48 × 48` | Página de administración de extensiones |
| `src/icons/icon128.png` | `128 × 128` | Chrome Web Store / Instalador |
