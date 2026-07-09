import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

// --- CONFIGURACIÓN ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Conexión a Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(client => {
    console.log("✅ Conectado a Supabase");
    client.release();
  })
  .catch(err => console.error("❌ Error conectando a Supabase:", err));

// --- ENDPOINTS PARA USUARIOS ---

app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT usuario_id, nombre, correo, rol, sucursal_id FROM usuarios WHERE correo = $1 AND password = crypt($2, password)',
      [correo, password]
    );

    if (result.rows.length > 0) {
      res.status(200).json({
          mensaje: 'Bienvenido',
          usuario_id: result.rows[0].usuario_id,
          nombre: result.rows[0].nombre,
          rol: result.rows[0].rol,
          sucursal_id: result.rows[0].sucursal_id,
          token: 'token_simulado_123'
      });
    } else {
      res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/crear-admin', async (req, res) => {
  const { nombre, correo, password } = req.body;
  if (!correo.toLowerCase().endsWith('@tiendasv.com')) {
    return res.status(400).json({ error: 'El correo debe ser @tiendasv.com' });
  }
  try {
    await pool.query(
      "INSERT INTO usuarios (nombre, correo, password, rol) VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), $4)",
      [nombre, correo, password, 'admin']
    );
    res.status(201).json({ mensaje: 'Administrador creado correctamente' });
  } catch (err) {
    res.status(400).json({ error: 'Error al crear admin' });
  }
});

// --- ENDPOINTS PARA PRODUCTOS ---
app.get('/productos', async (req, res) => {
  const { sucursal_id, usuario_id } = req.query;
  try {
    let query = `
      SELECT p.*, c.nombre as categoria, s.nombre as sucursal_nombre, u.nombre as vendedor_nombre
      FROM productos p 
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id 
      LEFT JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios u ON u.usuario_id = p.usuario_id
    `;
    let params = [];
    let conditions = [];
    if (usuario_id && usuario_id !== '0') {
      params.push(usuario_id);
      conditions.push(`p.usuario_id = $${params.length}`);
    } else if (sucursal_id && sucursal_id !== '0') {
      params.push(sucursal_id);
      conditions.push(`p.sucursal_id = $${params.length}`);
    }
    if (conditions.length > 0) query += ` WHERE ` + conditions.join(' AND ');
    query += ` ORDER BY p.producto_id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/productos', async (req, res) => {
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id } = req.body;  
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *', 
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET codigo_barras = $1, nombre = $2, categoria_id = $3, precio = $4, costo = $5, stock = $6, imagen_url = $7, activo = $8, sucursal_id = $9 WHERE producto_id = $10 RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE productos SET activo = false WHERE producto_id = $1', [id]);
    res.status(200).json({ mensaje: "Producto marcado como inactivo" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/sucursales', async (req, res) => {
  const { repartidor_id } = req.query;
  try {
    let query = `
      SELECT s.*, 
             (SELECT estado FROM solicitudes_repartidor 
              WHERE sucursal_id = s.sucursal_id AND repartidor_id = $1 LIMIT 1) as estado_solicitud
      FROM sucursales s ORDER BY s.nombre ASC
    `;
    const result = await pool.query(query, [repartidor_id || null]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- VENTAS ---
app.post('/ventas', async (req, res) => {
  const { producto_id, usuario_id, cantidad, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, repartidor_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [cantidad, producto_id]);
    await client.query(
      `INSERT INTO movimientos 
       (producto_id, usuario_id, tipo, cantidad, fecha, metodo_pago, entrega_domicilio, direccion_entrega, telefono_contacto, estado_entrega, repartidor_id) 
       VALUES ($1, $2, 'salida', $3, NOW(), $4, $5, $6, $7, $8, $9)`,
      [producto_id, usuario_id, cantidad, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, 
       entregaDomicilio ? 'Pendiente' : 'Completado', repartidor_id || null]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Venta realizada" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/ventas/multiple', async (req, res) => {
  const { items, usuario_id, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, repartidor_id } = req.body;
  const client = await pool.connect();
  const compra_id = `TRX-${Date.now()}`;
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [item.cantidad, item.producto_id]);
      await client.query(
        `INSERT INTO movimientos
         (producto_id, usuario_id, tipo, cantidad, fecha, metodo_pago, entrega_domicilio, direccion_entrega, telefono_contacto, estado_entrega, repartidor_id, compra_id)
         VALUES ($1, $2, 'salida', $3, NOW(), $4, $5, $6, $7, $8, $9, $10)`,
        [item.producto_id, usuario_id, item.cantidad, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto,
         entregaDomicilio ? 'Pendiente' : 'Completado', repartidor_id || null, compra_id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Compra múltiple realizada con éxito", compra_id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});


// --- GESTIÓN DEL CARRITO (PERSISTENCIA TOTAL) ---

// 1. Obtener el carrito guardado (Indispensable para recuperar datos al abrir la app)
app.get('/carrito', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.*, ci.cantidad as cantidad_carrito, c.nombre as categoria, s.nombre as sucursal_nombre
      FROM carrito_items ci
      JOIN productos p ON ci.producto_id = p.producto_id
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id
      LEFT JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      WHERE ci.usuario_id = $1 AND ci.sucursal_id = $2
    `, [usuario_id, sucursal_id]);
    res.json(result.rows);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// 2. Sincronizar el carrito completo (Se usa al cerrar o actualizar masivamente)
app.post('/carrito/sync', async (req, res) => {
  const { usuario_id, sucursal_id, items } = req.body; 
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Limpiamos el estado anterior para esta tienda/usuario
    await client.query(
      'DELETE FROM carrito_items WHERE usuario_id = $1 AND sucursal_id = $2',
      [usuario_id, sucursal_id]
    );
    // Insertamos los productos actuales con sus cantidades
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          'INSERT INTO carrito_items (usuario_id, sucursal_id, producto_id, cantidad) VALUES ($1, $2, $3, $4)',
          [usuario_id, sucursal_id, item.producto_id, item.cantidad || 1]
        );
      }
    }
    await client.query('COMMIT');
    res.status(200).json({ mensaje: "Carrito sincronizado correctamente" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { 
    client.release(); 
  }
});

// 3. Agregar o actualizar un solo item (Para persistencia inmediata al presionar "Añadir")
app.post('/carrito', async (req, res) => {
  const { usuario_id, sucursal_id, producto_id, cantidad } = req.body;
  try {
    await pool.query(
      `INSERT INTO carrito_items (usuario_id, sucursal_id, producto_id, cantidad) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id, sucursal_id, producto_id) 
       DO UPDATE SET cantidad = EXCLUDED.cantidad, fecha_agregado = NOW()`,
      [usuario_id, sucursal_id, producto_id, cantidad || 1]
    );
    res.status(201).json({ mensaje: 'Producto actualizado en el carrito' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// 4. Eliminar un item específico del carrito
app.delete('/carrito', async (req, res) => {
  const { usuario_id, sucursal_id, producto_id } = req.query;
  try {
    await pool.query(
      'DELETE FROM carrito_items WHERE usuario_id = $1 AND sucursal_id = $2 AND producto_id = $3',
      [usuario_id, sucursal_id, producto_id]
    );
    res.status(200).json({ mensaje: 'Producto eliminado del carrito' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});



app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
