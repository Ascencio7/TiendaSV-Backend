import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

// --- CONFIGURACIÓN DE MEDIOS ---
app.use(cors());
// Aumentamos el límite a 50mb para permitir el envío de fotos en Base64
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

// app.post('/login', async (req, res) => {
//   const { correo, password } = req.body;
//   try {
//     const result = await pool.query(
//       'SELECT usuario_id, nombre, correo, rol FROM usuarios WHERE correo = $1 AND password = $2',
//       [correo, password]
//     );

// // En tu backend, modifica la respuesta del /login:
// if (result.rows.length > 0) {
//   res.status(200).json({
//     mensaje: 'Bienvenido',
//     usuario_id: result.rows[0].usuario_id,
//     nombre: result.rows[0].nombre,
//     rol: result.rows[0].rol, // <--- AGREGA ESTA LÍNEA
//     token: 'token_simulado_123' 
//   });
// } else {
//       res.status(401).json({ mensaje: 'Credenciales inválidas' });
//     }
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });


app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  try {
    // Agregamos 'rol' y 'sucursal_id' a la consulta
    const result = await pool.query(
      'SELECT usuario_id, nombre, correo, rol, sucursal_id FROM usuarios WHERE correo = $1 AND password = $2',
      [correo, password]
    );

    if (result.rows.length > 0) {
      res.status(200).json({
        mensaje: 'Bienvenido',
        usuario_id: result.rows[0].usuario_id,
        nombre: result.rows[0].nombre,
        rol: result.rows[0].rol,          // <--- IMPORTANTE
        sucursal_id: result.rows[0].sucursal_id, // <--- IMPORTANTE
        token: 'token_simulado_123' 
      });
    } else {
      res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/usuarios', async (req, res) => {
  const { nombre, correo, password, rol } = req.body;
  try {
    await pool.query(
      'INSERT INTO usuarios (nombre, correo, password, rol) VALUES ($1, $2, $3, $4)',
      [nombre, correo, password, rol || 'vendedor']
    );
    res.status(201).json({ mensaje: 'Usuario registrado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINTS PARA PRODUCTOS (CRUD) ---

app.get('/productos', async (req, res) => {
  try {
    const query = `
      SELECT p.*, c.nombre as categoria 
      FROM productos p 
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id 
      ORDER BY p.producto_id DESC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (resto del código igual hasta llegar a productos)

// Crear producto (Incluyendo campo activo)
app.post('/productos', async (req, res) => {
  const { codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo !== undefined ? activo : true]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar producto (Incluyendo campo activo)
app.put('/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo } = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET codigo_barras = $1, nombre = $2, categoria_id = $3, precio = $4, stock = $5, imagen_url = $6, activo = $7 WHERE producto_id = $8 RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ELIMINACIÓN LÓGICA: En lugar de DELETE, hacemos un UPDATE
app.delete('/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE productos SET activo = false WHERE producto_id = $1', [id]);
    res.status(200).json({ mensaje: "Producto marcado como inactivo" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINT PARA VENTAS ---

// Registrar una venta (Descuenta stock y guarda movimiento)
app.post('/ventas', async (req, res) => {
  const { producto_id, usuario_id, cantidad, precio_unitario } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Iniciamos transacción

    // 1. Verificar stock actual
    const resStock = await client.query('SELECT stock FROM productos WHERE producto_id = $1', [producto_id]);
    if (resStock.rows[0].stock < cantidad) {
      throw new Error('Stock insuficiente');
    }

    // 2. Descontar stock
    await client.query(
      'UPDATE productos SET stock = stock - $1 WHERE producto_id = $2',
      [cantidad, producto_id]
    );

    // 3. Registrar en tabla de movimientos (Salida)
    const total = cantidad * precio_unitario;
    await client.query(
      'INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, fecha) VALUES ($1, $2, $3, $4, NOW())',
      [producto_id, usuario_id, 'salida', cantidad]
    );

    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Venta realizada con éxito", total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Obtener historial de ventas
app.get('/ventas/historial', async (req, res) => {
  try {
    const query = `
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      WHERE m.tipo = 'salida'
      ORDER BY m.fecha DESC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- ENDPOINT PARA LISTAR SUCURSALES (Usado por el cliente para elegir tienda) ---
app.get('/sucursales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sucursales ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- REGISTRO DE USUARIO + CREACIÓN DE TIENDA ---
app.post('/usuarios', async (req, res) => {
  const { nombre, correo, password, rol, nombreTienda, direccionTienda } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let sucursalId = null;

    // Si es vendedor, creamos primero su sucursal (tienda)
    if (rol === 'vendedor' && nombreTienda) {
      const resTienda = await client.query(
        'INSERT INTO sucursales (nombre, direccion) VALUES ($1, $2) RETURNING sucursal_id',
        [nombreTienda, direccionTienda]
      );
      sucursalId = resTienda.rows[0].sucursal_id;
    }

    // Insertamos el usuario vinculado a la sucursal creada
    await client.query(
      'INSERT INTO usuarios (nombre, correo, password, rol, sucursal_id) VALUES ($1, $2, $3, $4, $5)',
      [nombre, correo, password, rol || 'cliente', sucursalId]
    );

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Usuario y tienda registrados con éxito' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- PRODUCTOS: Ahora devolvemos nombre de tienda y vendedor (JOIN) ---
app.get('/productos', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*, 
        c.nombre as categoria, 
        s.nombre as sucursal_nombre, 
        u.nombre as vendedor_nombre
      FROM productos p 
      LEFT JOIN categorias c ON p.categoria_id = c.categoria_id 
      LEFT JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios u ON u.sucursal_id = s.sucursal_id AND u.rol = 'vendedor'
      ORDER BY p.producto_id DESC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});





app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));