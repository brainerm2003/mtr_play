// PASO 3 y 6: preparar (limpiar) y validar datos ANTES de guardarlos.
const CATEGORIAS = ['electrodomesticos', 'hogar', 'telefonia'];

const limpiar = (t) => String(t ?? '').normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();

// Letras (con tildes), numeros, espacios y . ' - ( ) /  -> rechaza < > " ; = etc.
const TEXTO_SEGURO = /^[\p{L}\p{N} .'\-()/+]+$/u;
const EMAIL = /^[^\s@<>"';]+@[^\s@<>"';]+\.[^\s@<>"';]{2,}$/;

function validarRegistro(b) {
  const nombre = limpiar(b?.nombre);
  const email = limpiar(b?.email).toLowerCase();
  const password = String(b?.password ?? '');
  if (!nombre || !email || !password) return { error: 'Faltan datos obligatorios (nombre, correo y contraseña)' };
  if (nombre.length < 2 || nombre.length > 60) return { error: 'El nombre debe tener entre 2 y 60 caracteres' };
  if (!TEXTO_SEGURO.test(nombre)) return { error: 'El nombre contiene caracteres no permitidos' };
  if (email.length > 120 || !EMAIL.test(email)) return { error: 'El correo tiene un formato inválido' };
  if (password.length < 8 || password.length > 100) return { error: 'La contraseña debe tener entre 8 y 100 caracteres' };
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return { error: 'La contraseña debe incluir letras y números' };
  return { valor: { nombre, email, password } };
}

function validarProducto(b) {
  const sku = limpiar(b?.sku).toUpperCase();
  const nombre = limpiar(b?.nombre);
  const categoria = limpiar(b?.categoria).toLowerCase();
  const icono = limpiar(b?.icono) || '🛒';
  if (!sku || !nombre || !categoria || b?.precio === undefined || b?.precio === '' || b?.stock === undefined || b?.stock === '')
    return { error: 'Faltan datos obligatorios (sku, nombre, categoría, precio y stock)' };
  if (!/^[A-Z0-9-]{3,20}$/.test(sku)) return { error: 'El SKU debe tener 3 a 20 letras, números o guiones' };
  if (nombre.length < 3 || nombre.length > 80) return { error: 'El nombre debe tener entre 3 y 80 caracteres' };
  if (!TEXTO_SEGURO.test(nombre)) return { error: 'El nombre contiene caracteres no permitidos' };
  if (!CATEGORIAS.includes(categoria)) return { error: `Categoría inválida. Use: ${CATEGORIAS.join(', ')}` };
  const precio = Number(b.precio);
  const stock = Number(b.stock);
  if (!Number.isFinite(precio) || precio <= 0 || precio > 50_000_000) return { error: 'El precio debe ser un número mayor a 0 y menor a 50.000.000' };
  if (!Number.isInteger(stock) || stock < 0 || stock > 10_000) return { error: 'El stock debe ser un entero entre 0 y 10000' };
  if ([...icono].length > 4) return { error: 'El icono es demasiado largo' };
  return { valor: { sku, nombre, categoria, precio, stock, icono } };
}

module.exports = { CATEGORIAS, limpiar, validarRegistro, validarProducto };
