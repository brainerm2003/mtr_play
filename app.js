// Frontend de MTR PLAY. Todo se pinta con textContent / append (nunca innerHTML con datos) -> evita XSS.
const $ = (s) => document.querySelector(s);
const dinero = (n) => Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const NOMBRES_CAT = { electrodomesticos: 'Electrodomésticos', hogar: 'Para la casa', telefonia: 'Para tu teléfono' };
const estado = { usuario: null, productos: [], carrito: new Map(), categoria: '' };

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const h of hijos.flat()) n.append(h instanceof Node ? h : String(h));
  return n;
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error || 'Error inesperado');
  return datos;
}

function aviso(texto, tipo = 'ok') {
  const caja = $('#mensaje');
  caja.replaceChildren(el('p', { class: tipo }, texto));
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => caja.replaceChildren(), 5000);
}
const manejar = (fn) => async (e) => {
  e?.preventDefault?.();
  try { await fn(e); } catch (err) { aviso(err.message, 'error'); }
};

function ver(vista) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== vista;
  for (const b of document.querySelectorAll('nav button[data-vista]')) b.classList.toggle('activo', b.dataset.vista === vista);
  window.scrollTo({ top: 0 });
  if (vista === 'catalogo') cargarCatalogo();
  if (vista === 'carrito') pintarCarrito();
  if (vista === 'pedidos') cargarPedidos();
  if (vista === 'admin') cargarAdmin();
}

function pintarSesion() {
  const u = estado.usuario;
  $('#nav-auth').hidden = !!u;
  $('#nav-salir').hidden = !u;
  $('#nav-pedidos').hidden = !u;
  $('#nav-admin').hidden = !(u && u.rol === 'admin');
}

function tarjeta(p) {
  const agotado = p.stock === 0;
  const bajo = p.stock > 0 && p.stock < 5;
  return el('div', { class: 'card' },
    el('div', { class: 'vitrina' }, p.icono || '🛒'),
    el('span', { class: 'cat' }, NOMBRES_CAT[p.categoria] || p.categoria || ''),
    el('h3', {}, p.nombre),
    el('span', { class: 'precio' }, dinero(p.precio)),
    el('span', { class: 'stock' + (agotado ? ' agotado' : bajo ? ' bajo' : '') },
      agotado ? 'Agotado' : bajo ? `¡Últimas ${p.stock} unidades!` : `${p.stock} disponibles`),
    el('button', { class: 'primario', ...(agotado ? { disabled: '' } : {}), onclick: () => agregar(p) }, agotado ? 'Sin stock' : 'Agregar al carrito')
  );
}

function pintarCatalogo() {
  const q = $('#buscar').value.trim().toLowerCase();
  const lista = estado.productos.filter((p) => !q || p.nombre.toLowerCase().includes(q));
  $('#productos').replaceChildren(...(lista.length ? lista.map(tarjeta) : [el('p', { class: 'vacio' }, estado.productos.length ? 'No encontramos productos con esa búsqueda.' : 'Aún no hay productos. Ejecuta "npm run seed" y recarga la página.')]));
}

async function cargarCatalogo() {
  const c = estado.categoria;
  estado.productos = await api('GET', '/api/productos' + (c ? `?categoria=${encodeURIComponent(c)}` : ''));
  pintarCatalogo();
}

let agregar = function (p) {
  const actual = estado.carrito.get(p.sku)?.cantidad || 0;
  if (actual + 1 > p.stock) return aviso(`Solo hay ${p.stock} unidades de ${p.nombre}`, 'error');
  estado.carrito.set(p.sku, { ...p, cantidad: actual + 1 });
  actualizarContador();
  aviso(`✔ ${p.nombre} agregado al carrito`);
};
function actualizarContador() {
  $('#contador').textContent = [...estado.carrito.values()].reduce((a, i) => a + i.cantidad, 0);
}

async function pintarCarrito() {
  const items = [...estado.carrito.values()];
  $('#lineas').replaceChildren(...(items.length ? items.map((i) =>
    el('div', { class: 'linea' },
      el('span', { class: 'ico' }, i.icono),
      el('div', { class: 'nom' }, el('b', {}, i.nombre), el('div', { class: 'stock' }, dinero(i.precio) + ' c/u')),
      el('button', { class: 'sec', onclick: () => cambiar(i.sku, -1) }, '−'),
      el('span', { class: 'qty' }, i.cantidad),
      el('button', { class: 'sec', onclick: () => cambiar(i.sku, +1) }, '+'),
      el('p', { class: 'sub' }, dinero(i.precio * i.cantidad)))) : [el('p', { class: 'vacio' }, 'Tu carrito está vacío. ¡Agrega algo de la tienda!')]));
  $('#total').textContent = dinero(items.reduce((a, i) => a + i.precio * i.cantidad, 0));
  $('#confirmar').disabled = items.length === 0;
  // Recomendación (regla): productos de la misma categoría del último producto agregado
  const ultimo = items[items.length - 1];
  if (!ultimo) return $('#recomendados').replaceChildren();
  try {
    const recs = await api('GET', `/api/recomendaciones?sku=${encodeURIComponent(ultimo.sku)}`);
    $('#recomendados').replaceChildren(...recs.filter((r) => !estado.carrito.has(r.sku)).map(tarjeta));
  } catch { /* sin recomendaciones */ }
}
function cambiar(sku, delta) {
  const i = estado.carrito.get(sku);
  const nueva = i.cantidad + delta;
  if (nueva <= 0) estado.carrito.delete(sku);
  else if (nueva > i.stock) return aviso(`Solo hay ${i.stock} unidades`, 'error');
  else i.cantidad = nueva;
  actualizarContador(); pintarCarrito();
}
// Si se agrega desde "te puede interesar", refrescar el carrito
const agregarOriginal = agregar;
agregar = function (p) { agregarOriginal(p); if (!$('#carrito').hidden) pintarCarrito(); };

async function confirmarPedido() {
  if (!estado.usuario) { aviso('Inicia sesión para confirmar tu pedido', 'error'); return ver('auth'); }
  const items = [...estado.carrito.values()].map((i) => ({ sku: i.sku, cantidad: i.cantidad }));
  const r = await api('POST', '/api/pedidos', { items });
  estado.carrito.clear(); actualizarContador();
  ver('pedidos');
  aviso(`✅ Pedido #${r.pedido} confirmado. Total: ${dinero(r.total)}`);
}

async function cargarPedidos() {
  const pedidos = await api('GET', '/api/pedidos');
  $('#lista-pedidos').replaceChildren(...(pedidos.length ? pedidos.map((p) =>
    el('div', { class: 'pedido' },
      el('b', {}, `Pedido #${p.id}`), ` · ${p.creado} · ${dinero(p.total)}`,
      el('ul', {}, p.items.map((i) => el('li', {}, `${i.cantidad} × ${i.nombre}`))))) : [el('p', { class: 'vacio' }, 'Aún no tienes pedidos.')]));
}

async function cargarAdmin() {
  const a = await api('GET', '/api/alertas/stock-bajo');
  $('#alertas').replaceChildren(...(a.productos.length ? a.productos.map((p) => el('li', {}, p.mensaje)) : [el('li', {}, 'Todo el inventario está en buen nivel ✅')]));
  const v = await api('GET', '/api/resumen/mas-vendidos');
  $('#vendidos').replaceChildren(...(v.length ? v.map((p) => el('li', {}, `${p.nombre}: ${p.vendidas} vendidas`)) : [el('li', {}, 'Todavía no hay ventas.')]));
}

async function iniciar() {
  estado.usuario = (await api('GET', '/api/me')).usuario;
  pintarSesion();
  ver('catalogo');
}

// Si abrieron el archivo con doble clic, avisar cómo hacerlo bien.
if (location.protocol === 'file:') {
  document.body.prepend(el('div', { class: 'aviso-archivo' },
    '⚠ Abriste el archivo directamente. Ejecuta "npm start" en la terminal y entra a http://localhost:3000'));
} else {
  for (const b of document.querySelectorAll('nav button[data-vista]')) b.addEventListener('click', manejar(() => ver(b.dataset.vista)));
  for (const b of document.querySelectorAll('#pills .pill')) b.addEventListener('click', manejar(async () => {
    document.querySelectorAll('#pills .pill').forEach((x) => x.classList.toggle('activa', x === b));
    estado.categoria = b.dataset.cat; await cargarCatalogo();
  }));
  $('#buscar').addEventListener('input', () => { if ($('#catalogo').hidden) ver('catalogo'); else pintarCatalogo(); });
  $('#ver-ofertas').addEventListener('click', () => $('#pills').scrollIntoView({ behavior: 'smooth' }));
  $('#confirmar').addEventListener('click', manejar(confirmarPedido));
  $('#nav-salir').addEventListener('click', manejar(async () => {
    await api('POST', '/api/logout'); estado.usuario = null; pintarSesion(); ver('catalogo'); aviso('Sesión cerrada');
  }));
  $('#form-login').addEventListener('submit', manejar(async (e) => {
    const d = Object.fromEntries(new FormData(e.target));
    estado.usuario = (await api('POST', '/api/login', d)).usuario;
    e.target.reset(); pintarSesion(); ver('catalogo'); aviso(`Bienvenido, ${estado.usuario.nombre}`);
  }));
  $('#form-registro').addEventListener('submit', manejar(async (e) => {
    const r = await api('POST', '/api/registro', Object.fromEntries(new FormData(e.target)));
    e.target.reset(); aviso(r.mensaje);
  }));
  $('#form-producto').addEventListener('submit', manejar(async (e) => {
    const r = await api('POST', '/api/productos', Object.fromEntries(new FormData(e.target)));
    aviso(r.mensaje); cargarAdmin();
  }));
  manejar(iniciar)();
}
