import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;
const app = express();

// Configuraciones
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Conexión a Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Prueba de conexion a supabase
pool.connect()
  .then(client => {
    console.log("✅ Conectado a Supabase");
    client.release();
  })
  .catch(err => console.error("❌ Error conectando a Supabase:", err));



 // Endpoints de TiendaSV - Jonathan Vladimir Ascencio Ramos 



// CATEGORIAS

// Las categorias son los tipos de productos del vendedor
app.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// SUCURSALES

// Las sucursales son las tiendas de los vendedores
app.get('/sucursales', async (req, res) => {
  const { repartidor_id } = req.query; // Capturamos el parámetro enviado desde Android
  try {
    let query = `
      SELECT s.*, 
             (SELECT estado FROM solicitudes_repartidor 
              WHERE sucursal_id = s.sucursal_id AND repartidor_id = $1 LIMIT 1) as estado_solicitud
      FROM sucursales s 
      ORDER BY s.nombre ASC
    `;
    const result = await pool.query(query, [repartidor_id || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// UBICACIONES

// Obtener todos los departamentos de la base
app.get('/departamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departamentos ORDER BY depar ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// MUNICIPIOS

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


// Comentarios de los clientes de la tienda por su compra realizada
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



// INICIO DE SESION

// Login
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
        sucursal_id: result.rows[0].sucursal_id, // <--- ESTO ES VITAL NO ELIMINAR
        token: 'token_simulado_123' 
    });
    } else {
      res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Registro de Usuario
app.post('/usuarios', async (req, res) => {
  const { 
    nombre, correo, telefono, password, rol,
    nombreTienda, direccionTienda, departamentoTienda, municipioTienda,
    latitud, longitud,
    tipo_transporte, bici_marca, bici_color, bici_caracteristica,
    auto_marca_id, moto_marca_id, marca_otra,
    vehiculo_modelo, vehiculo_color, vehiculo_placa,
    vehiculo_tipo, vehiculo_anio, vehiculo_estado
  } = req.body;
  
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
      `INSERT INTO usuarios (
        nombre, correo, telefono, password, rol, sucursal_id, activo,
        tipo_transporte, bici_marca, bici_color, bici_caracteristica,
        auto_marca_id, moto_marca_id, marca_otra,
        vehiculo_modelo, vehiculo_color, vehiculo_placa,
        vehiculo_tipo, vehiculo_anio, vehiculo_estado
      ) VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 10)), $5, $6, true, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        nombre, correo, telefono, password, rol || 'cliente', sucursalId,
        tipo_transporte, bici_marca, bici_color, bici_caracteristica,
        auto_marca_id, moto_marca_id, marca_otra,
        vehiculo_modelo, vehiculo_color, vehiculo_placa,
        vehiculo_tipo, vehiculo_anio, vehiculo_estado
      ]
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



// MARCAS DE MOTOS

// Obtener marcas de motos de la base
app.get('/marcas/motos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM marcas_motos ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// MARCAS DE AUTOS

// Obtener marcas de autos de la base
app.get('/marcas/autos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM marcas_autos ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Restablecer Contraseña
app.put('/usuarios/reset-password', async (req, res) => {
  const { correo, nuevaPassword } = req.body;

  if (!correo || !nuevaPassword) {
    return res.status(400).json({ error: 'Faltan datos obligatorios (correo o nuevaPassword)' });
  }
  try {
    await client.query('BEGIN');
    const resUser = await client.query(
      `UPDATE usuarios SET 
        nombre = $1, correo = $2, telefono = $3, 
        password = COALESCE(crypt($4, gen_salt('bf', 10)), password), 
        foto_perfil = COALESCE($5, foto_perfil), rol = $6, activo = $7,
        -- ... otros campos
      WHERE usuario_id = $25 RETURNING sucursal_id`,
      [ nuevaPassword, correo]
    );

    if (result.rows.length > 0) {
      res.status(200).json({ mensaje: 'Contraseña actualizada con éxito' });
    } else {
      // Si result.rows está vacío es porque el WHERE correo = $2 no encontró coincidencias
      res.status(404).json({ error: 'El correo electrónico no está registrado' });
    }
  } catch (err) {
    console.error("ERROR RESET PASSWORD:", err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});



// VENDEDORES

// Obtener repartidores vinculados y aceptados de una tienda específica
app.get('/vendedor/solicitudes/:sucursal_id', async (req, res) => {
  try {
    const result = await pool.query(
        `SELECT s.solicitud_id, s.repartidor_id, s.sucursal_id, s.estado, 
                u.nombre as repartidor_nombre, u.correo as repartidor_correo,
                u.telefono as repartidor_telefono,
                u.foto_perfil as repartidor_foto, u.tipo_transporte
        FROM solicitudes_repartidor s
       JOIN usuarios u ON s.repartidor_id = u.usuario_id
       WHERE s.sucursal_id = $1 AND s.estado = 'pendiente'`,
      [req.params.sucursal_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Obtener lista de repartidores del Vendedor
app.get('/vendedor/repartidores/:sucursal_id', async (req, res) => {
  try {
    const result = await pool.query(
    `SELECT usuario_id, nombre, correo, telefono, activo, tipo_transporte, foto_perfil 
    FROM usuarios 
    WHERE sucursal_id = $1 AND rol = 'repartidor'
       ORDER BY nombre ASC`,
      [req.params.sucursal_id]
    );
    res.json(result.rows);
  } catch (err) { 
    console.error("Error al obtener repartidores:", err.message);
    res.status(500).json({ error: err.message }); 
  }
});


// El Vendedor elimine a un repartidor
app.post('/vendedor/repartidores/eliminar', async (req, res) => {
  const { sucursal_id, repartidor_id } = req.body;
  
  if (!sucursal_id || !repartidor_id) {
    return res.status(400).json({ error: 'Faltan IDs: sucursal o repartidor' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Quitar la vinculación en la tabla usuarios
    await client.query(
      'UPDATE usuarios SET sucursal_id = NULL WHERE usuario_id = $1',
      [repartidor_id]
    );

    // IMPORTANTE: En lugar de borrar la solicitud la marcamos como eliminada
    // Esto permite que el repartidor vea el mensaje de "VENDEDOR TE ELIMINÓ"
    await client.query(
      "UPDATE solicitudes_repartidor SET estado = 'eliminado' WHERE repartidor_id = $1 AND sucursal_id = $2",
      [repartidor_id, sucursal_id]
    );

    await client.query('COMMIT');
    res.status(200).json({ mensaje: 'Repartidor eliminado con éxito' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("ERROR AL ELIMINAR:", err.message); // Esto saldrá en tu consola de Node.js
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});


// Aceptar o Rechazar solicitud del repartidor
app.put('/vendedor/solicitudes/:id', async (req, res) => {
  const { estado, sucursal_id, repartidor_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Actualizar estado de solicitud
    await client.query('UPDATE solicitudes_repartidor SET estado = $1 WHERE solicitud_id = $2', [estado, req.params.id]);
    
    // Si se acepta, vinculamos al repartidor a la tienda en la tabla usuarios
    if (estado === 'aceptado') {
      await client.query('UPDATE usuarios SET sucursal_id = $1 WHERE usuario_id = $2', [sucursal_id, repartidor_id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: `Solicitud ${estado}` });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});



// REPARTIDORES

// Ver sus pedidos
app.get('/repartidor/pedidos', async (req, res) => {
  const { sucursal_id, repartidor_id } = req.query;
  try {
    const result = await pool.query(`
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total, 
             s.nombre as sucursal_nombre, u.nombre as usuario_nombre
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      LEFT JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios u ON m.usuario_id = u.usuario_id
      WHERE m.entrega_domicilio = true 
      AND m.estado_entrega = 'Pendiente'
      AND (
        (m.repartidor_id IS NULL OR m.repartidor_id = 0) 
        OR m.repartidor_id = $2
      )
      AND p.sucursal_id = $1
      ORDER BY m.fecha DESC`, [sucursal_id, repartidor_id]);
    res.json(result.rows);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

app.put('/repartidor/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado_entrega, repartidor_id } = req.body;
  try {
    let query = 'UPDATE movimientos SET estado_entrega = $1';
    let params = [estado_entrega];

    // Si el repartidor acepta un pedido de la lista de 'Disponibles'
    if (repartidor_id && repartidor_id !== 0) {
      query += ', repartidor_id = $2 WHERE movimiento_id = $3';
      params.push(repartidor_id, id);
    } else {
      query += ' WHERE movimiento_id = $2';
      params.push(id);
    }

    await pool.query(query, params);
    res.status(200).json({ mensaje: 'Estado actualizado' });
  } catch (err) { 
    console.error("Error actualizando pedido:", err.message);
    res.status(500).json({ error: err.message }); 
  }
});


// Enviar solicitud de unión a una tienda activa
app.post('/repartidor/solicitar', async (req, res) => {
  const { repartidor_id, sucursal_id, accion } = req.body;
  try {
    if (accion === 'cancelar') {
      // Borra la solicitud si el repartidor decide cancelarla
      await pool.query(
        'DELETE FROM solicitudes_repartidor WHERE repartidor_id = $1 AND sucursal_id = $2',
        [repartidor_id, sucursal_id]
      );
      return res.status(200).json({ mensaje: 'Solicitud cancelada' });
    }

    await pool.query(
      `INSERT INTO solicitudes_repartidor (repartidor_id, sucursal_id, estado) 
       VALUES ($1, $2, 'pendiente')
       ON CONFLICT (repartidor_id, sucursal_id) 
       DO UPDATE SET estado = 'pendiente'`,
      [repartidor_id, sucursal_id]
    );
    res.status(201).json({ mensaje: 'Solicitud enviada con éxito' });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});


// Ver alertas de cancelacion de pedidos por parte del cliente
app.get('/repartidor/:repartidor_id/alertas-cancelacion', async (req, res) => {
  const { repartidor_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT m.*, p.nombre as producto_nombre, u.nombre as usuario_nombre
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN usuarios u ON m.usuario_id = u.usuario_id
      WHERE m.repartidor_id = $1 AND m.solicitud_cancelacion = true
    `, [repartidor_id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Ver sus pedidos filtrados por estado: Pedidos, En Camino y Entregado
app.get('/repartidor/mis-pedidos', async (req, res) => {
  const { repartidor_id, estado } = req.query; 
  try {
    const result = await pool.query(`
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total,
             s.nombre as sucursal_nombre, u.nombre as usuario_nombre
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      LEFT JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios u ON m.usuario_id = u.usuario_id
      WHERE m.repartidor_id = $1 
      AND m.estado_entrega = $2
      ORDER BY m.fecha DESC`, [repartidor_id, estado]);
    res.json(result.rows);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});



// ADMINISTRADORES

// Crear otros Admins
app.post('/admin/crear-admin', async (req, res) => {
  const { nombre, correo, password } = req.body;

  // OBLIGATORIO: Debe ser dominio corporativo sino no creara el usuario administrador
  if (!correo.toLowerCase().endsWith('@tiendasv.com')) {
    return res.status(400).json({ error: 'El correo debe ser @tiendasv.com' });
  }
  try {
    await pool.query(
      "INSERT INTO usuarios (nombre, correo, password, rol) VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), $4)",
      [nombre, correo, password, 'admin']
    );
    res.status(201).json({ mensaje: 'Administrador creado correctamente' });
  } catch (err) { /* ... */ }
});


// Comentarios de los clientes de la tienda y sus productos comprados
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
    // Solo mostramos comentarios de la tienda seleccionada
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


// Reporte de Inventario: Tienda, total productos y valor total
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


// Reporte de Ventas con Filtro de Tienda
app.get('/admin/reporte-ventas', async (req, res) => {
  const { sucursal_id } = req.query;
  try {
      let query = `
        SELECT 
          m.fecha, 
          p.nombre as producto, 
          m.cantidad, 
          (m.cantidad * p.precio) as total,
          (m.cantidad * (p.precio - COALESCE(p.costo, 0))) as ganancia_neta,
          s.nombre as tienda, 
          u.nombre as vendedor
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


// Reporte de Usuarios con Filtros: Estado, Rol, Usuario Específico
// Reporte de Usuarios con TODOS los campos para Perfil
app.get('/admin/reporte-usuarios', async (req, res) => {
  const { activo, rol, usuario_id } = req.query;
  try {
    let query = `
      SELECT 
        u.*, 
        s.nombre as nombre_tienda, 
        s.direccion as direccion_tienda, 
        s.departamento as departamento_tienda, 
        s.municipio as municipio_tienda,
        s.latitud, s.longitud
      FROM usuarios u
      LEFT JOIN sucursales s ON u.sucursal_id = s.sucursal_id
      WHERE 1=1
    `;
    let params = [];

    if (activo !== undefined && activo !== '') {
      params.push(activo === 'true');
      query += ` AND u.activo = $${params.length}`;
    }
    if (rol && rol !== 'Todos') {
      params.push(rol.toLowerCase());
      query += ` AND u.rol = $${params.length}`;
    }
    if (usuario_id && usuario_id !== '0') {
      params.push(usuario_id);
      query += ` AND u.usuario_id = $${params.length}`;
    }

    query += ` ORDER BY u.rol, u.nombre`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Actualizar los datos de los usuarios
app.put('/admin/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    nombre, correo, telefono, password, rol, activo, foto_perfil,
    tipo_transporte, bici_marca, bici_color, bici_caracteristica,
    auto_marca_id, moto_marca_id, marca_otra,
    vehiculo_modelo, vehiculo_color, vehiculo_placa,
    vehiculo_tipo, vehiculo_anio, vehiculo_estado,
    // Campos de pago añadidos
    tarjeta_nombre, tarjeta_numero, tarjeta_fecha, tarjeta_cvv,
    // Campos de tienda
    nombre_tienda, direccion_tienda, departamento_tienda, municipio_tienda, latitud, longitud
  } = req.body; 

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Actualizar tabla usuarios (Incluyendo campos de pago)
    const resUser = await client.query(
      `UPDATE usuarios SET 
        nombre = $1, correo = $2, telefono = $3,
        password = COALESCE(crypt($4, gen_salt('bf', 10)), password),
        foto_perfil = COALESCE($5, foto_perfil), rol = $6, activo = $7,
        tipo_transporte = $8, bici_marca = $9, bici_color = $10, bici_caracteristica = $11,
        auto_marca_id = $12, moto_marca_id = $13, marca_otra = $14,
        vehiculo_modelo = $15, vehiculo_color = $16, vehiculo_placa = $17,
        vehiculo_tipo = $18, vehiculo_anio = $19, vehiculo_estado = $20,
        tarjeta_nombre = $21, tarjeta_numero = $22, tarjeta_fecha = $23, tarjeta_cvv = $24
      WHERE usuario_id = $25 RETURNING sucursal_id`,
      [
        nombre, correo, telefono, password, foto_perfil, rol, activo,
        tipo_transporte, bici_marca, bici_color, bici_caracteristica,
        auto_marca_id, moto_marca_id, marca_otra,
        vehiculo_modelo, vehiculo_color, vehiculo_placa,
        vehiculo_tipo, vehiculo_anio, vehiculo_estado,
        tarjeta_nombre, tarjeta_numero, tarjeta_fecha, tarjeta_cvv,
        id
      ]
    );

    // Si es Vendedor, actualizar también la información de su Tienda (sucursales)
    if (rol === 'vendedor' && resUser.rows.length > 0 && resUser.rows[0].sucursal_id) {
      await client.query(
        `UPDATE sucursales SET 
          nombre = $1, direccion = $2, departamento = $3, municipio = $4, 
          latitud = $5, longitud = $6 
        WHERE sucursal_id = $7`,
        [nombre_tienda, direccion_tienda, departamento_tienda, municipio_tienda, latitud, longitud, resUser.rows[0].sucursal_id]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({ mensaje: 'Perfil y Tienda actualizados correctamente' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("ERROR SQL:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// Obtener la lista de las tiendas activas e inactivas
app.get('/admin/sucursales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sucursales ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Crear nueva tienda
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


// Actualizar datos de la tienda
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


// Resumen de ventas de la tienda
app.get('/admin/resumen-ventas-detallado', async (req, res) => {
  const { sucursal_id } = req.query;
  try {
    let query = `
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total,
             u.nombre as usuario_nombre, s.nombre as sucursal_nombre
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN usuarios u ON m.usuario_id = u.usuario_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      WHERE m.tipo = 'salida'
    `;
    let params = [];
    if (sucursal_id && sucursal_id !== '0') {
      query += ` AND p.sucursal_id = $1`;
      params.push(sucursal_id);
    }
    query += ` ORDER BY m.fecha DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Se muestran las tiendas que tienen al menos un repartidor vinculado
app.get('/admin/sucursales-con-repartidores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT s.* 
      FROM sucursales s
      JOIN usuarios u ON s.sucursal_id = u.sucursal_id
      WHERE u.rol = 'repartidor'
      ORDER BY s.nombre ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Detalle completo de un repartidor y su tienda (para el reporte PDF)
app.get('/admin/detalle-repartidor/:usuario_id', async (req, res) => {
  const { usuario_id } = req.params;
  try {
    const query = `
      SELECT 
        u.*, 
        ma.nombre as auto_marca_nombre, mm.nombre as moto_marca_nombre,
        s.nombre as tienda_nombre, s.direccion as tienda_direccion, 
        s.departamento as tienda_departamento, s.municipio as tienda_municipio,
        (SELECT nombre FROM usuarios WHERE sucursal_id = s.sucursal_id AND rol = 'vendedor' LIMIT 1) as vendedor_nombre,
        (SELECT telefono FROM usuarios WHERE sucursal_id = s.sucursal_id AND rol = 'vendedor' LIMIT 1) as vendedor_telefono,
        (SELECT correo FROM usuarios WHERE sucursal_id = s.sucursal_id AND rol = 'vendedor' LIMIT 1) as vendedor_correo
      FROM usuarios u
      LEFT JOIN sucursales s ON u.sucursal_id = s.sucursal_id
      LEFT JOIN marcas_autos ma ON u.auto_marca_id = ma.marca_id
      LEFT JOIN marcas_motos mm ON u.moto_marca_id = mm.marca_id
      WHERE u.usuario_id = $1
    `;
    const result = await pool.query(query, [usuario_id]);
    res.json(result.rows[0] || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Obtener resumen de tiendas por ubicación (Departamento/Municipio) y porcentajes
app.get('/admin/stats/sucursales-ubicacion', async (req, res) => {
  const { departamento_id } = req.query;
  try {
    const totalGlobalRes = await pool.query('SELECT COUNT(*) FROM sucursales WHERE activo = true');
    const totalGeneral = parseInt(totalGlobalRes.rows[0].count);

    // 1. Stats por Departamento
    const deptoRes = await pool.query(`
      SELECT UPPER(TRIM(departamento)) as nombre, COUNT(*) as cantidad, 
             ROUND((COUNT(*)::numeric / NULLIF($1, 0)) * 100, 2) as porcentaje
      FROM sucursales WHERE activo = true
      GROUP BY UPPER(TRIM(departamento)) ORDER BY cantidad DESC
    `, [totalGeneral]);

    let munResults = [];
    if (departamento_id && departamento_id !== '0') {
       const dInfo = await pool.query('SELECT depar FROM departamentos WHERE id = $1', [departamento_id]);
       if (dInfo.rows.length > 0) {
         const deptoNombre = dInfo.rows[0].depar;
         const totalDeptoRes = await pool.query('SELECT COUNT(*) FROM sucursales WHERE activo = true AND UPPER(TRIM(departamento)) = UPPER(TRIM($1))', [deptoNombre]);
         const totalDepto = parseInt(totalDeptoRes.rows[0].count);

         const munRes = await pool.query(`
           SELECT UPPER(TRIM(municipio)) as nombre, COUNT(*) as cantidad,
                  ROUND((COUNT(*)::numeric / NULLIF($1, 0)) * 100, 2) as porcentaje
           FROM sucursales WHERE activo = true AND UPPER(TRIM(departamento)) = UPPER(TRIM($2))
           GROUP BY UPPER(TRIM(municipio)) ORDER BY cantidad DESC
         `, [totalDepto, deptoNombre]);
         munResults = munRes.rows;
       }
    } else {
       const munRes = await pool.query(`
         SELECT UPPER(TRIM(municipio)) as nombre, COUNT(*) as cantidad,
                ROUND((COUNT(*)::numeric / NULLIF($1, 0)) * 100, 2) as porcentaje
         FROM sucursales WHERE activo = true
         GROUP BY UPPER(TRIM(municipio)) ORDER BY cantidad DESC
       `, [totalGeneral]);
       munResults = munRes.rows;
    }

    res.json({
      total: totalGeneral,
      por_departamento: deptoRes.rows,
      por_municipio: munResults
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// PRODUCTOS

// Listar los productos de la tienda
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

    // Si viene usuario_id (Vendedor) solo ve sus productos creados
    if (usuario_id && usuario_id !== '0') {
      params.push(usuario_id);
      conditions.push(`p.usuario_id = $${params.length}`);
    } 
    // Si viene sucursal_id (Cliente) ve todo lo de esa tienda
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


// Al crear un producto lo guardamos de quién es el dueño: usuario_id
app.post('/productos', async (req, res) => {
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id } = req.body;  
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *', 
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Actualizar los datos de un producto en especifico
app.put('/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET codigo_barras = $1, nombre = $2, categoria_id = $3, precio = $4, costo = $5, stock = $6, imagen_url = $7, activo = $8, sucursal_id = $9 WHERE producto_id = $10 RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Desactivar un producto de manera lógica, pues puede volver a ser activado
// ademas de que se respeta la relación y la auditoria de los movimientos en la base de datos
app.delete('/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE productos SET activo = false WHERE producto_id = $1', [id]);
    res.status(200).json({ mensaje: "Producto marcado como inactivo" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// VENTAS

// Registro con asignación de repartidor
app.post('/ventas', async (req, res) => {
  const { producto_id, usuario_id, cantidad, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, repartidor_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Descontar stock
    await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [cantidad, producto_id]);
    
    // Insertar movimiento con el repartidor específico asignado por el cliente
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


// Historial de ventas
app.get('/ventas/historial', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  try {
    const result = await pool.query(`
      SELECT 
        m.compra_id as movimiento_id_str,
        MAX(m.movimiento_id) as movimiento_id,
        MAX(p.sucursal_id) as sucursal_id,
        STRING_AGG(p.nombre || ' (x' || m.cantidad || ')', ', ') as producto_nombre,
        SUM(m.cantidad) as cantidad,
        SUM(m.cantidad * p.precio) as total,
        SUM(m.cantidad * (p.precio - COALESCE(p.costo, 0))) as ganancia_neta,
        MAX(m.fecha) as fecha,
        MAX(s.nombre) as sucursal_nombre,
        MAX(m.estado_entrega) as estado_entrega
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      WHERE m.tipo = 'salida' 
      AND (m.usuario_id = $1 OR $1 IS NULL)
      AND (p.sucursal_id = $2 OR $2 IS NULL)
      -- LÓGICA VITAL: Solo mostrar si ya se entregó o si fue venta física (no domicilio)
      AND (m.entrega_domicilio = false OR m.estado_entrega = 'Entregado')
      GROUP BY m.compra_id, m.fecha
      ORDER BY fecha DESC
    `, [usuario_id || null, sucursal_id || null]);
    res.json(result.rows);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});


// Registro de ventas multiple con el Carrito
app.post('/ventas/multiple', async (req, res) => {
  const { items, usuario_id, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, repartidor_id } = req.body;
  const client = await pool.connect();
  const compra_id = `TRX-${Date.now()}`; // Identificador único para agrupar el pedido

  try {
    await client.query('BEGIN');
    
    for (const item of items) {
      // Descontar stock
      await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [item.cantidad, item.producto_id]);
      
      // Insertar movimiento con el compra_id
      await client.query(
        `INSERT INTO movimientos 
         (producto_id, usuario_id, tipo, cantidad, fecha, metodo_pago, entrega_domicilio, direccion_entrega, telefono_contacto, estado_entrega, repartidor_id, compra_id) 
         VALUES ($1, $2, 'salida', $3, NOW(), $4, $5, $6, $7, $8, $9, $10)`,
        [
          item.producto_id, usuario_id, item.cantidad, metodoPago, 
          entregaDomicilio, direccionEntrega, telefonoContacto, 
          entregaDomicilio ? 'Pendiente' : 'Completado', 
          repartidor_id || null, compra_id
        ]
      );
    }
    
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Compra múltiple realizada con éxito", compra_id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { 
    client.release(); 
  }
});


// Procesar decisión: Aceptar o Declinar cancelación del pedido
app.post('/ventas/:id/procesar-cancelacion', async (req, res) => {
  const { id } = req.params;
  const { accion } = req.body; 
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (accion === 'aceptar') {
      const mov = await client.query("SELECT producto_id, cantidad FROM movimientos WHERE movimiento_id = $1", [id]);
      await client.query("UPDATE productos SET stock = stock + $1 WHERE producto_id = $2", [mov.rows[0].cantidad, mov.rows[0].producto_id]);
      await client.query("UPDATE movimientos SET estado_entrega = 'Cancelado', solicitud_cancelacion = false WHERE movimiento_id = $1", [id]);
    } else {
      await client.query("UPDATE movimientos SET solicitud_cancelacion = false WHERE movimiento_id = $1", [id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: "Procesado correctamente" });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});


// Editar o solicitar cancelacion desde el cliente

// Editar detalles del pedido: Solo si está Pendiente
app.put('/ventas/:id/detalles', async (req, res) => {
  const { id } = req.params;
  const { direccion_entrega, telefono_contacto } = req.body;
  try {
    const result = await pool.query(
      `UPDATE movimientos 
       SET direccion_entrega = $1, telefono_contacto = $2 
       WHERE movimiento_id = $3 AND estado_entrega = 'Pendiente' 
       RETURNING *`,
      [direccion_entrega, telefono_contacto, id]
    );
    if (result.rows.length > 0) res.json(result.rows[0]);
    else res.status(400).json({ error: "No se puede editar, el pedido ya está en camino." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Solicitar cancelación al repartidor: Si está 'En Camino'
app.post('/ventas/:id/solicitar-cancelacion', async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;
  try {
    await pool.query(
      "UPDATE movimientos SET solicitud_cancelacion = true, motivo_cancelacion = $1 WHERE movimiento_id = $2",
      [motivo, id]
    );
    res.json({ mensaje: "Solicitud enviada al repartidor" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Cancelar pedido definitivamente: Devuelve el stock
app.post('/ventas/:id/cancelar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await client.query("SELECT producto_id, cantidad FROM movimientos WHERE movimiento_id = $1", [id]);
    await client.query("UPDATE productos SET stock = stock + $1 WHERE producto_id = $2", [mov.rows[0].cantidad, mov.rows[0].producto_id]);
    await client.query("UPDATE movimientos SET estado_entrega = 'Cancelado' WHERE movimiento_id = $1", [id]);
    await client.query('COMMIT');
    res.json({ mensaje: "Pedido cancelado con éxito" });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});


// Obtener detalle del seguimiento con una Barra de Estado
app.get('/ventas/:id/seguimiento', async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total,
             u_rep.nombre as repartidor_nombre, u_rep.telefono as repartidor_telefono, 
             u_rep.correo as repartidor_correo, u_rep.foto_perfil as repartidor_foto, 
             u_rep.tipo_transporte
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      LEFT JOIN usuarios u_rep ON m.repartidor_id = u_rep.usuario_id
      WHERE m.movimiento_id = $1
    `;
    const result = await pool.query(query, [id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// CLIENTE: Ver solo pedidos activos de una tienda específica 
app.get('/ventas/activas', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  try {
    let query = `
      SELECT m.*, p.nombre as producto_nombre, (m.cantidad * p.precio) as total,
             s.nombre as sucursal_nombre
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      WHERE m.usuario_id = $1 
      AND m.entrega_domicilio = true
      AND m.estado_entrega IN ('Pendiente', 'En Camino')
    `;
    let params = [usuario_id];
    if (sucursal_id && sucursal_id !== '0') {
      params.push(sucursal_id);
      query += ` AND p.sucursal_id = $2`;
    }
    query += ` ORDER BY m.fecha DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});



//  CARRRITO DE COMPRAS

// Obtener el carrito guardado del usuario para una tienda específica
app.get('/carrito', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  try {
    const result = await pool.query(`
      SELECT p.*, c.nombre as categoria, s.nombre as sucursal_nombre
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


// Sincronizar el carrito: Guardar el estado actual de la app en la base de datos
app.post('/carrito/sync', async (req, res) => {
  const { usuario_id, sucursal_id, items } = req.body; 
  // 'items' debe ser un array de objetos con {producto_id}
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Primero limpiamos el carrito viejo de ese usuario en esa tienda
    await client.query(
      'DELETE FROM carrito_items WHERE usuario_id = $1 AND sucursal_id = $2',
      [usuario_id, sucursal_id]
    );
    
    // Insertamos los productos actuales
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          'INSERT INTO carrito_items (usuario_id, sucursal_id, producto_id, cantidad) VALUES ($1, $2, $3, $4)',
          [usuario_id, sucursal_id, item.producto_id, 1]
        );
      }
    }
    
    await client.query('COMMIT');
    res.status(200).json({ mensaje: "Carrito sincronizado en la nube" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// Mensaje de que la API esta funcionando en RENDER
app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

// Iniciar el servidor en el puerto 3000
const PORT = process.env.PORT || 3000;

// Iniciar el servidor con el numero de puerto
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));