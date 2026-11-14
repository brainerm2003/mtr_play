// PASO 3: carga de datos SIN duplicar. Se puede ejecutar muchas veces (npm run seed).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { validarProducto, validarRegistro } = require('./validar');
const { hashPassword } = require('./auth');

const UPSERT = `
  INSERT INTO productos (sku, nombre, categoria, precio, stock, icono)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(sku) DO UPDATE SET
    nombre = excluded.nombre, categoria = excluded.categoria,
    precio = excluded.precio, stock = excluded.stock, icono = excluded.icono`;

function cargarProductos() {
  const crudos = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'productos.json'), 'utf8'));
  const antes = db.prepare('SELECT COUNT(*) AS n FROM productos').get().n;
  let rechazados = 0;
  for (const crudo of crudos) {
    const { valor, error } = validarProducto(crudo);   // limpiar + validar antes de guardar
    if (error) { rechazados++; console.log(`  ✗ Rechazado ${crudo.sku}: ${error}`); continue; }
    db.prepare(UPSERT).run(valor.sku, valor.nombre, valor.categoria, valor.precio, valor.stock, valor.icono);
  }
  const despues = db.prepare('SELECT COUNT(*) AS n FROM productos').get().n;
  console.log(`Productos en el archivo: ${crudos.length} | rechazados: ${rechazados}`);
  console.log(`Filas en la tabla ANTES: ${antes} | DESPUÉS: ${despues}  (nuevas: ${despues - antes})`);
}

function crearAdmin() {
  const email = 'admin@mtrplay.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin12345';
  const { valor } = validarRegistro({ nombre: 'Administrador', email, password });
  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'admin')
              ON CONFLICT(email) DO NOTHING`).run(valor.nombre, valor.email, hashPassword(valor.password));
  console.log(`Administrador listo: ${email}`);
}

cargarProductos();
crearAdmin();
