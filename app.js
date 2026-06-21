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
      'SELECT usuario_id, nombre, correo, rol, sucursal_id FROM usuarios WHERE correo = $1 AND password = $2',
      [correo, password]
    );

    if (result.rows.length > 0) {
    // En app.js, dentro de app.post('/login', ...)
    res.status(200).json({
        mensaje: 'Bienvenido',
        usuario_id: result.rows[0].usuario_id,
        nombre: result.rows[0].nombre,
        rol: result.rows[0].rol,
        sucursal_id: result.rows[0].sucursal_id, // <--- ESTO ES VITAL
        token: 'token_simulado_123' 
    });
    } else {
      res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINT EXCLUSIVO PARA ADMIN (Crea otros Admins) ---
app.post('/admin/crear-admin', async (req, res) => {
  const { nombre, correo, password } = req.body;

  // OBLIGATORIO: Debe ser dominio corporativo
  if (!correo.toLowerCase().endsWith('@tiendasv.com')) {
    return res.status(400).json({ error: 'El correo debe ser @tiendasv.com' });
  }

  try {
    await pool.query(
      'INSERT INTO usuarios (nombre, correo, password, rol) VALUES ($1, $2, $3, $4)',
      [nombre, correo, password, 'admin']
    );
    res.status(201).json({ mensaje: 'Administrador creado correctamente' });
  } catch (err) {
    res.status(400).json({ error: 'Error al crear admin' });
  }
});

// --- ENDPOINTS PARA PRODUCTOS (CRUD) ---

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

    // Si viene usuario_id (Vendedor), solo ve sus productos
    if (usuario_id && usuario_id !== '0') {
      params.push(usuario_id);
      conditions.push(`p.usuario_id = $${params.length}`);
    } 
    // Si viene sucursal_id (Cliente), ve todo lo de esa tienda
    else if (sucursal_id && sucursal_id !== '0') {
      params.push(sucursal_id);
      conditions.push(`p.sucursal_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    
    query += ` ORDER BY p.producto_id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Al crear producto, guardamos quién es el dueño (usuario_id)
app.post('/productos', async (req, res) => {
  const { codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo, sucursal_id, usuario_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo, sucursal_id, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo !== undefined ? activo : true, sucursal_id, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put('/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo, sucursal_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET codigo_barras = $1, nombre = $2, categoria_id = $3, precio = $4, stock = $5, imagen_url = $6, activo = $7, sucursal_id = $8 WHERE producto_id = $9 RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, stock, imagen_url, activo, sucursal_id, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/sucursales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sucursales ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- VENTAS ---

app.post('/ventas', async (req, res) => {
  const { producto_id, usuario_id, cantidad, precio_unitario } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resStock = await client.query('SELECT stock FROM productos WHERE producto_id = $1', [producto_id]);
    if (resStock.rows[0].stock < cantidad) throw new Error('Stock insuficiente');

    await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [cantidad, producto_id]);
    await client.query(
      'INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, fecha) VALUES ($1, $2, $3, $4, NOW())',
      [producto_id, usuario_id, 'salida', cantidad]
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Venta realizada con éxito" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- HISTORIAL DE VENTAS Y ESTADÍSTICAS (CORREGIDO) ---
app.get('/ventas/historial', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  try {
    let query = `
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total, m.usuario_id,
             p.sucursal_id, s.nombre as sucursal_nombre,
             c.comentario_id, c.texto as comentario_texto, c.calificacion as comentario_calificacion
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN comentarios c ON c.movimiento_id = m.movimiento_id -- VÍNCULO ÚNICO POR COMPRA
      WHERE m.tipo = 'salida'
    `;
    
    let params = [];
    if (usuario_id && usuario_id !== 'null' && usuario_id !== '0' && usuario_id !== 'undefined') {
        params.push(usuario_id);
        query += ` AND m.usuario_id = $${params.length}`;
    } 
    
    if (sucursal_id && sucursal_id !== 'null' && sucursal_id !== '0' && sucursal_id !== 'undefined') {
        params.push(sucursal_id);
        query += ` AND p.sucursal_id = $${params.length}`;
    }

    query += ` ORDER BY m.fecha DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message });  
  }
});

app.get('/admin/comentarios', async (req, res) => {
  const { sucursal_id } = req.query; // Capturamos el filtro enviado por la App
  try {
    let query = `
      SELECT c.*, 
             u.nombre as cliente_nombre, 
             s.nombre as sucursal_nombre, 
             p.nombre as producto_nombre,
             (SELECT nombre FROM usuarios WHERE sucursal_id = s.sucursal_id AND rol = 'vendedor' LIMIT 1) as responsable_nombre
      FROM comentarios c
      JOIN usuarios u ON c.usuario_id = u.usuario_id
      JOIN sucursales s ON c.sucursal_id = s.sucursal_id
      LEFT JOIN productos p ON c.producto_id = p.producto_id
    `;
    
    let params = [];
    // FILTRO VITAL: Solo mostramos comentarios de la tienda seleccionada
    if (sucursal_id && sucursal_id !== 'null' && sucursal_id !== '0') {
      params.push(sucursal_id);
      query += ` WHERE c.sucursal_id = $1`;
    }

    query += ` ORDER BY c.fecha DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("ERROR COMMENTS:", err.message);
    res.status(500).json({ error: err.message });
  }
});



// --- ENDPOINT PARA RESTABLECER CONTRASEÑA ---

app.put('/usuarios/reset-password', async (req, res) => {
  const { correo, nuevaPassword } = req.body;

  if (!correo || !nuevaPassword) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (correo o nuevaPassword)' });
  }

  try {
    // Actualizamos la contraseña solo si el correo existe
    const result = await pool.query(
      'UPDATE usuarios SET password = $1 WHERE correo = $2 RETURNING usuario_id',
      [nuevaPassword, correo]
    );

    if (result.rows.length > 0) {
      res.status(200).json({ mensaje: 'Contraseña actualizada con éxito' });
    } else {
      // Si result.rows está vacío, es porque el WHERE correo = $2 no encontró coincidencias
      res.status(404).json({ error: 'El correo electrónico no está registrado' });
    }
  } catch (err) {
    console.error("ERROR RESET PASSWORD:", err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// --- ENDPOINTS PARA REPORTES ADMINISTRATIVOS MEJORADOS ---

// 1. Reporte de Inventario: Tienda, total productos y valor total
app.get('/admin/reporte-inventario', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.nombre as tienda, 
             COUNT(p.producto_id) as total_productos, 
             COALESCE(SUM(p.stock * p.precio), 0) as valor_total
      FROM sucursales s
      LEFT JOIN productos p ON s.sucursal_id = p.sucursal_id AND p.activo = true
      GROUP BY s.sucursal_id, s.nombre
      ORDER BY s.nombre ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Reporte de Ventas con Filtro de Tienda
app.get('/admin/reporte-ventas', async (req, res) => {
  const { sucursal_id } = req.query;
  try {
    let query = `
      SELECT m.fecha, p.nombre as producto, m.cantidad, (m.cantidad * p.precio) as total, 
             s.nombre as tienda, u.nombre as vendedor
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      JOIN usuarios u ON p.usuario_id = u.usuario_id
      WHERE m.tipo = 'salida'
    `;
    let params = [];
    if (sucursal_id && sucursal_id !== 'null' && sucursal_id !== '0') {
      params.push(sucursal_id);
      query += ` AND s.sucursal_id = $${params.length}`;
    }
    query += ` ORDER BY m.fecha DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Reporte de Usuarios con Filtros (Estado, Rol, Usuario Específico)
app.get('/admin/reporte-usuarios', async (req, res) => {
  const { activo, rol, usuario_id } = req.query;
  try {
    // IMPORTANTE: Agregamos usuario_id al SELECT
    let query = `SELECT usuario_id, nombre, correo, rol, activo, creado_en FROM usuarios WHERE 1=1`;
    let params = [];

    if (activo !== undefined && activo !== '') {
      params.push(activo === 'true');
      query += ` AND activo = $${params.length}`;
    }
    if (rol && rol !== 'Todos') {
      params.push(rol.toLowerCase());
      query += ` AND rol = $${params.length}`;
    }
    if (usuario_id && usuario_id !== '0') {
      params.push(usuario_id);
      query += ` AND usuario_id = $${params.length}`;
    }

    query += ` ORDER BY rol, nombre`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINT PARA ACTUALIZAR USUARIO (Incluye Edición y Desactivación) ---
app.put('/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  // CAMBIO: Agregamos password y foto_perfil aquí
  const { nombre, correo, password, rol, activo, foto_perfil } = req.body; 
  try {
    const result = await pool.query(
      // CAMBIO: Agregamos foto_perfil al UPDATE
      'UPDATE usuarios SET nombre = $1, correo = $2, password = COALESCE($3, password), foto_perfil = $4, rol = $5, activo = $6 WHERE usuario_id = $7 RETURNING *',
      [nombre, correo, password, foto_perfil, rol, activo, id]
    );

    if (result.rows.length > 0) {
      res.status(200).json({ mensaje: 'Usuario actualizado correctamente' });
    } else {
      res.status(404).json({ error: 'Usuario no encontrado' });
    }
  } catch (err) {
    console.error("ERROR UPDATE USER:", err.message);
    res.status(500).json({ error: 'Error al actualizar el usuario' });
  }
});

// --- GESTIÓN DE TIENDAS (ADMIN) ---
// --- GESTIÓN DE TIENDAS (ADMIN) ---

// 1. OBTENER TODAS LAS TIENDAS (Activas e Inactivas) - ¡VITAL PARA QUE CARGUEN!
app.get('/admin/sucursales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sucursales ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. CREAR NUEVA TIENDA (Incluyendo Municipio)
app.post('/admin/sucursales', async (req, res) => {
  const { nombre, direccion, departamento, municipio, latitud, longitud } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO sucursales (nombre, direccion, departamento, municipio, latitud, longitud, activo) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *',
      [nombre, direccion, departamento, municipio, latitud, longitud]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ACTUALIZAR TIENDA (Incluyendo Municipio y Estado)
app.put('/admin/sucursales/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, direccion, departamento, municipio, activo, latitud, longitud } = req.body;
  try {
    await pool.query(
      'UPDATE sucursales SET nombre = $1, direccion = $2, departamento = $3, municipio = $4, activo = $5, latitud = $6, longitud = $7 WHERE sucursal_id = $8',
      [nombre, direccion, departamento, municipio, activo, latitud, longitud, id]
    );
    res.status(200).json({ mensaje: 'Tienda actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- REGISTRO DE USUARIO (Descomentado y corregido) ---
app.post('/usuarios', async (req, res) => {
  const { nombre, correo, password, rol, nombreTienda, direccionTienda, departamentoTienda, municipioTienda } = req.body;
  
  if (correo.toLowerCase().endsWith('@tiendasv.com')) {
    return res.status(403).json({ error: 'Dominio reservado para administradores.' });
  }

const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let sucursalId = null;

    if (rol === 'vendedor') {
      const resTienda = await client.query(
        'INSERT INTO sucursales (nombre, direccion, departamento, municipio, latitud, longitud, activo) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING sucursal_id',
        [nombreTienda, direccionTienda, departamentoTienda, municipioTienda, latitud, longitud]
      );
      sucursalId = resTienda.rows[0].sucursal_id;
    }

    await client.query(
      'INSERT INTO usuarios (nombre, correo, password, rol, sucursal_id, activo) VALUES ($1, $2, $3, $4, $5, true)',
      [nombre, correo, password, rol || 'cliente', sucursalId]
    );

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Usuario registrado con éxito' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// app.get('/ventas/historial', async (req, res) => {
//   const { usuario_id, sucursal_id } = req.query;
//   try {
//     let query = `
//       SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total, m.usuario_id,
//              p.sucursal_id, s.nombre as sucursal_nombre
//       FROM movimientos m
//       JOIN productos p ON m.producto_id = p.producto_id
//       JOIN sucursales s ON p.sucursal_id = s.sucursal_id
//       WHERE m.tipo = 'salida'
//     `;
    
//     let params = [];
//     if (usuario_id && (!sucursal_id || sucursal_id === 'null')) {
//         params.push(usuario_id);
//         query += ` AND m.usuario_id = $${params.length}`;
//     } else if (sucursal_id && sucursal_id !== 'null') {
//         params.push(sucursal_id);
//         query += ` AND p.sucursal_id = $${params.length}`;
//     }

//     query += ` ORDER BY m.fecha DESC`;
//     const result = await pool.query(query, params);
//     res.json(result.rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// Sugerencia para archivo app.js
app.post('/comentarios', async (req, res) => {
  const { sucursal_id, usuario_id, producto_id, texto, calificacion, movimiento_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO comentarios (sucursal_id, usuario_id, producto_id, texto, calificacion, movimiento_id) 
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (movimiento_id) 
       DO UPDATE SET texto = EXCLUDED.texto, calificacion = EXCLUDED.calificacion, fecha = NOW()`,
      [sucursal_id, usuario_id, producto_id, texto, calificacion, movimiento_id]
    );
    res.status(201).json({ mensaje: 'Comentario guardado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// --- ENDPOINTS PARA UBICACIONES ---

// Obtener todos los departamentos
app.get('/departamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departamentos ORDER BY depar ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener municipios (filtrados por departamento si se desea)
app.get('/municipios', async (req, res) => {
  const { departamento_id } = req.query;
  try {
    let query = 'SELECT * FROM municipios';
    let params = [];
    if (departamento_id) {
      query += ' WHERE departamentosid = $1';
      params.push(departamento_id);
    }
    query += ' ORDER BY nombremunicipio ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));