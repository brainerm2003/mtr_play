// MTR PLAY - servidor (solo Node.js, sin dependencias externas)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { limpiar, validarRegistro, validarProducto } = require('./validar');
const { hashPassword, verificarPassword } = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const STOCK_BAJO = 5;
const sesiones = new Map(); // token -> { id, nombre, rol }

class HttpError extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

const SEGURIDAD = {
  // Cabeceras que bloquean scripts inyectados (defensa extra contra XSS)
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

function enviar(res, status, data, extra = {}) {
  const cuerpo = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SEGURIDAD, ...extra });
  res.end(cuerpo);
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

function leerJson(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => { datos += c; if (datos.length > 100_000) { reject(new HttpError(413, 'Solicitud demasiado grande')); req.destroy(); } });
    req.on('end', () => {
      if (!datos) return resolve({});
      try { resolve(JSON.parse(datos)); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
  });
}

const exigirLogin = (u) => { if (!u) throw new HttpError(401, 'Debes iniciar sesión'); };
const exigirAdmin = (u) => { exigirLogin(u); if (u.rol !== 'admin') throw new HttpError(403, 'Solo para administradores'); };

const rutas = {
  // ---------- Usuarios ----------
  'POST /api/registro': async ({ body, res }) => {
    const { valor, error } = validarRegistro(body);
    if (error) throw new HttpError(400, error);
    try {
      db.prepare('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)')
        .run(valor.nombre, valor.email, hashPassword(valor.password));   // consulta parametrizada + hash
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ese correo ya está registrado');
      throw e;
    }
    return [201, { ok: true, mensaje: 'Cuenta creada. Ya puedes iniciar sesión.' }];
  },

  'POST /api/login': async ({ body }) => {
    const email = limpiar(body.email).toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!u || !verificarPassword(String(body.password ?? ''), u.password_hash))
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, { id: u.id, nombre: u.nombre, rol: u.rol });
    return [200, { ok: true, usuario: { nombre: u.nombre, rol: u.rol } },
      { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200` }];
  },

  'POST /api/logout': async ({ req }) => {
    sesiones.delete(leerCookie(req, 'sid'));
    return [200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }];
  },

  'GET /api/me': async ({ user }) => [200, { usuario: user ? { nombre: user.nombre, rol: user.rol } : null }],

  // ---------- Catálogo ----------
  'GET /api/productos': async ({ url }) => {
    const cat = limpiar(url.searchParams.get('categoria')).toLowerCase();
    const filas = cat
      ? db.prepare('SELECT * FROM productos WHERE categoria = ? ORDER BY nombre').all(cat)
      : db.prepare('SELECT * FROM productos ORDER BY categoria, nombre').all();
    return [200, filas];
  },

  // Cargar / actualizar un producto (admin). Usa upsert: repetir la carga NO crea un registro doble.
  'POST /api/productos': async ({ body, user }) => {
    exigirAdmin(user);
    const { valor, error } = validarProducto(body);
    if (error) throw new HttpError(400, error);
    const existia = db.prepare('SELECT id FROM productos WHERE sku = ?').get(valor.sku);
    db.prepare(`INSERT INTO productos (sku, nombre, categoria, precio, stock, icono) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO UPDATE SET nombre = excluded.nombre, categoria = excluded.categoria,
      precio = excluded.precio, stock = excluded.stock, icono = excluded.icono`)
      .run(valor.sku, valor.nombre, valor.categoria, valor.precio, valor.stock, valor.icono);
    return [200, { ok: true, mensaje: existia ? 'Producto actualizado (no se duplicó)' : 'Producto creado' }];
  },

  // ---------- Pedidos (recorrido completo) ----------
  'POST /api/pedidos': async ({ body, user }) => {
    exigirLogin(user);
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20)
      throw new HttpError(400, 'El carrito está vacío o tiene demasiados productos');
    const pedido = new Map();
    for (const it of body.items) {
      const sku = limpiar(it?.sku).toUpperCase();
      const cant = Number(it?.cantidad);
      if (!sku || !Number.isInteger(cant) || cant < 1 || cant > 20)
        throw new HttpError(400, 'Cada producto necesita SKU y una cantidad entera entre 1 y 20');
      pedido.set(sku, (pedido.get(sku) || 0) + cant);
    }
    db.exec('BEGIN');
    try {
      let total = 0;
      const lineas = [];
      for (const [sku, cant] of pedido) {
        const p = db.prepare('SELECT * FROM productos WHERE sku = ?').get(sku);
        if (!p) throw new HttpError(400, `El producto ${sku} no existe`);
        if (p.stock < cant) throw new HttpError(409, `Stock insuficiente de "${p.nombre}" (quedan ${p.stock})`);
        total += p.precio * cant;
        lineas.push({ p, cant });
      }
      const r = db.prepare('INSERT INTO pedidos (usuario_id, total) VALUES (?, ?)').run(user.id, total);
      const pedidoId = Number(r.lastInsertRowid);
      for (const { p, cant } of lineas) {
        db.prepare('INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unit) VALUES (?, ?, ?, ?)').run(pedidoId, p.id, cant, p.precio);
        db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(cant, p.id);
      }
      db.exec('COMMIT');
      return [201, { ok: true, pedido: pedidoId, total }];
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },

  'GET /api/pedidos': async ({ user }) => {
    exigirLogin(user);
    const pedidos = db.prepare('SELECT id, total, creado FROM pedidos WHERE usuario_id = ? ORDER BY id DESC').all(user.id);
    for (const p of pedidos) {
      p.items = db.prepare(`SELECT pr.nombre, pi.cantidad, pi.precio_unit FROM pedido_items pi
        JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = ?`).all(p.id);
    }
    return [200, pedidos];
  },

  // ---------- PASO 5: inteligencia con reglas ----------
  // Regla 1 (alerta): stock por debajo del umbral
  'GET /api/alertas/stock-bajo': async ({ user }) => {
    exigirAdmin(user);
    const filas = db.prepare('SELECT sku, nombre, stock FROM productos WHERE stock < ? ORDER BY stock ASC').all(STOCK_BAJO);
    return [200, { umbral: STOCK_BAJO, productos: filas.map((f) => ({ ...f, mensaje: `Quedan ${f.stock} unidades de ${f.nombre}. Conviene reponer.` })) }];
  },
  // Regla 2 (resumen): productos más vendidos
  'GET /api/resumen/mas-vendidos': async ({ user }) => {
    exigirAdmin(user);
    return [200, db.prepare(`SELECT pr.sku, pr.nombre, SUM(pi.cantidad) AS vendidas FROM pedido_items pi
      JOIN productos pr ON pr.id = pi.producto_id GROUP BY pr.id ORDER BY vendidas DESC LIMIT 5`).all()];
  },
  // Regla 3 (recomendación): otros productos de la misma categoría, los más vendidos primero
  'GET /api/recomendaciones': async ({ url }) => {
    const sku = limpiar(url.searchParams.get('sku')).toUpperCase();
    const p = db.prepare('SELECT id, categoria FROM productos WHERE sku = ?').get(sku);
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    return [200, db.prepare(`SELECT pr.sku, pr.nombre, pr.precio, pr.icono, pr.categoria, pr.stock FROM productos pr
      LEFT JOIN pedido_items pi ON pi.producto_id = pr.id
      WHERE pr.categoria = ? AND pr.id != ? AND pr.stock > 0
      GROUP BY pr.id ORDER BY COALESCE(SUM(pi.cantidad), 0) DESC, pr.nombre LIMIT 3`).all(p.categoria, p.id)];
  }
};

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function servirEstatico(req, res, pathname) {
  const archivo = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!archivo.startsWith(PUBLIC)) { res.writeHead(403, SEGURIDAD); return res.end('Prohibido'); }
  fs.readFile(archivo, (err, datos) => {
    if (err) { res.writeHead(404, SEGURIDAD); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', ...SEGURIDAD });
    res.end(datos);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return servirEstatico(req, res, decodeURIComponent(url.pathname));
    const handler = rutas[`${req.method} ${url.pathname}`];
    if (!handler) throw new HttpError(404, 'Ruta no encontrada');
    const body = req.method === 'POST' ? await leerJson(req) : {};
    const user = sesiones.get(leerCookie(req, 'sid')) || null;
    const [status, data, extra] = await handler({ req, res, url, body, user });
    enviar(res, status, data, extra);
  } catch (e) {
    if (e instanceof HttpError) return enviar(res, e.status, { error: e.message });
    console.error(e);
    enviar(res, 500, { error: 'Error interno del servidor' });
  }
});

if (require.main === module) {
  // Si la base está vacía, cargar los productos y el admin automáticamente
  if (db.prepare('SELECT COUNT(*) AS n FROM productos').get().n === 0) require('./seed');
  servidor.listen(PORT, () => console.log(`MTR PLAY listo en http://localhost:${PORT}`));
}
module.exports = servidor;
