# MTR PLAY

Tienda virtual de electrodomésticos, accesorios para casa y accesorios para teléfono.
Hecha solo con Node.js (sin dependencias): servidor HTTP + SQLite + HTML/JS.

## Requisitos
Node.js 22.13 o superior (`node -v`). Descargar en https://nodejs.org (versión LTS).

## Cómo ejecutarla
```bash
npm run seed    # (opcional) carga productos sin duplicar; npm start lo hace solo si la base está vacía
npm start       # abre http://localhost:3000
npm test        # pruebas automáticas (pasos 3, 4, 5 y 6)
```
Administrador: `admin@mtrplay.com` / `Admin12345`

> Importante: NO abras `index.html` con doble clic. Siempre entra por http://localhost:3000 con el servidor encendido.

## Dónde está cada paso
| Paso | Archivo |
|---|---|
| 3 Datos sin duplicar | `seed.js`, `db.js` (UNIQUE), `validar.js` (limpieza) |
| 4 Seguridad | `validar.js` (formularios), `auth.js` (hash scrypt), `server.js` (consultas con `?` y cabeceras CSP) |
| 5 Inteligencia | `server.js` → `/api/alertas/stock-bajo`, `/api/resumen/mas-vendidos`, `/api/recomendaciones` |
| 6 Dato malo | `validar.js` y `test.js` |
