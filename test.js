// Pruebas automáticas: sirven como evidencia para los pasos 3, 4, 5 y 6.
process.env.DB_FILE = ':memory:';
const servidor = require('./server');
const db = require('./db');
let ok = 0, fail = 0;
const check = (nombre, cond) => { cond ? ok++ : fail++; console.log(`${cond ? '✔' : '✘'} ${nombre}`); };

(async () => {
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://localhost:${servidor.address().port}`;
  let cookie = '';
  const api = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json() };
  };
  const { hashPassword } = require('./auth');
  db.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Admin','admin@mtrplay.com',?, 'admin')").run(hashPassword('Admin12345'));
  const prod = { sku: 'ELE-001', nombre: 'Licuadora 600W', categoria: 'electrodomesticos', precio: 189900, stock: 3, icono: '🥤' };

  let r = await api('POST', '/api/registro', { nombre: 'Ana Pérez', email: 'ANA@correo.com ', password: 'Clave12345' });
  check('Registro válido (201)', r.status === 201);
  r = await api('POST', '/api/registro', { nombre: 'Ana Pérez', email: 'ana@correo.com', password: 'Clave12345' });
  check('PASO 3: correo repetido no crea registro doble (409)', r.status === 409);
  check('PASO 4: contraseña guardada con hash', db.prepare("SELECT password_hash h FROM usuarios WHERE email='ana@correo.com'").get().h.startsWith('scrypt$'));
  r = await api('POST', '/api/registro', { nombre: '<script>alert(1)</script>', email: 'x@x.com', password: 'Clave12345' });
  check('PASO 4: XSS en formulario bloqueado (400)', r.status === 400);
  r = await api('POST', '/api/login', { email: "' OR '1'='1", password: "' OR '1'='1" });
  check("PASO 4: inyección SQL en login no entra (401)", r.status === 401);
  r = await api('POST', '/api/registro', { nombre: 'Luis', email: 'sin-arroba', password: 'Clave12345' });
  check('PASO 6: correo con formato incorrecto (400)', r.status === 400);
  r = await api('POST', '/api/registro', { nombre: '', email: '', password: '' });
  check('PASO 6: datos incompletos (400)', r.status === 400);

  r = await api('POST', '/api/pedidos', { items: [{ sku: 'ELE-001', cantidad: 1 }] });
  check('Pedido sin sesión rechazado (401)', r.status === 401);
  await api('POST', '/api/login', { email: 'admin@mtrplay.com', password: 'Admin12345' });
  r = await api('POST', '/api/productos', { ...prod, precio: -5 });
  check('PASO 6: precio negativo rechazado (400)', r.status === 400);
  r = await api('POST', '/api/productos', { ...prod, stock: 'abc' });
  check('PASO 6: stock con texto rechazado (400)', r.status === 400);
  await api('POST', '/api/productos', prod);
  r = await api('POST', '/api/productos', prod);
  const n = db.prepare('SELECT COUNT(*) n FROM productos').get().n;
  check('PASO 3: cargar dos veces el mismo producto deja 1 fila', n === 1 && r.status === 200);

  r = await api('POST', '/api/pedidos', { items: [{ sku: 'ELE-001', cantidad: 2 }] });
  check('Recorrido completo: pedido creado (201)', r.status === 201 && r.data.total === 379800);
  check('Stock descontado (3 → 1)', db.prepare("SELECT stock s FROM productos WHERE sku='ELE-001'").get().s === 1);
  r = await api('POST', '/api/pedidos', { items: [{ sku: 'ELE-001', cantidad: 5 }] });
  check('Stock insuficiente rechazado (409)', r.status === 409);
  r = await api('GET', '/api/alertas/stock-bajo');
  check('PASO 5: alerta de stock bajo detecta el producto', r.data.productos?.[0]?.sku === 'ELE-001');
  r = await api('GET', '/api/resumen/mas-vendidos');
  check('PASO 5: resumen de más vendidos', r.data[0]?.vendidas === 2);

  console.log(`\n${ok} correctas, ${fail} fallidas`);
  servidor.close(); process.exit(fail ? 1 : 0);
})();
