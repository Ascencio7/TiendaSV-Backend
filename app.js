import express from 'express';
import pkg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { GoogleGenerativeAI } from "@google/generative-ai";


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


// Configuración de NODEMAILER
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


// Método para enviar correos
const enviarCorreoNotificacion = async (destinatario, nombreUsuario, tipoAccion) => {
  let asunto = "";
  let mensaje = "";

  if (tipoAccion === 'reset_password') {
    asunto = "🔐 Seguridad: Contraseña Actualizada - TiendaSV";
    mensaje = `Hola ${nombreUsuario},\n\nTe informamos que la contraseña de tu cuenta en TiendaSV ha sido actualizada exitosamente.\n\nSi no realizaste este cambio, por favor contacta con soporte de inmediato.\n\nSaludos,\nEquipo de TiendaSV.`;
  }

  const mailOptions = {
    from: `"TiendaSV Soporte" <${process.env.EMAIL_USER}>`,
    to: destinatario,
    subject: asunto,
    text: mensaje
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Correo enviado:", info.messageId);
  } catch (error) {
    console.error("❌ Error Detallado de Nodemailer:");
    console.error("Código:", error.code);
    console.error("Comando:", error.command);
    console.error("Respuesta:", error.response);
  }
};



// ENDPOINT DE CHAT ASISTENTE

// Inicializar Gemini con la API KEY de las variables de entorno
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/chat/asistente', async (req, res) => {
  const { mensaje, rol, nombre } = req.body;
  console.log("NUEVA PETICIÓN DE CHAT"); // Esto saldrá en los logs de Render
  
  try {
    // Usamos el modelo 'gemini-pro' que es el más estable
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `Responde como SV-Bot de TiendaSV. Usuario: ${nombre} (${rol}). Pregunta: ${mensaje}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    res.json({ respuesta: response.text() });

  } catch (error) {
    console.error("❌ ERROR EN EL CÓDIGO NUEVO:", error.message);
    res.status(500).json({ error: error.message });
  }
});



 // Endpoints generales de TiendaSV - Jonathan Vladimir Ascencio Ramos 



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
  const { repartidor_id } = req.query;
  try {
    const query = `
      SELECT s.*, 
             COALESCE(rating.promedio_estrellas, 0) as promedio_estrellas,
             COALESCE(rating.total_resenas, 0) as total_resenas,
             (SELECT estado FROM solicitudes_repartidor 
              WHERE sucursal_id = s.sucursal_id AND repartidor_id = $1 LIMIT 1) as estado_solicitud
      FROM sucursales s 
      LEFT JOIN (
        SELECT sucursal_id, 
               ROUND(AVG(calificacion), 1) as promedio_estrellas,
               COUNT(*) as total_resenas
        FROM comentarios
        GROUP BY sucursal_id
      ) rating ON s.sucursal_id = rating.sucursal_id
      WHERE s.activo = true
      ORDER BY s.nombre ASC
    `;
    const result = await pool.query(query, [repartidor_id || null]);
    res.json(result.rows);
  } catch (err) {
    console.error("ERROR EXPLORAR TIENDAS:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Las tiendas con el mejor precio/promedio de productos mas bajos
app.get('/sucursales/mejor-precio', async (req, res) => {
  try {
    const query = `
      SELECT s.*, 
             ROUND(AVG(p.precio), 2) as precio_promedio,
             COALESCE(rating.promedio_estrellas, 0) as promedio_estrellas,
             COALESCE(rating.total_resenas, 0) as total_resenas
      FROM sucursales s
      JOIN productos p ON s.sucursal_id = p.sucursal_id
      LEFT JOIN (
        SELECT sucursal_id, 
               ROUND(AVG(calificacion), 1) as promedio_estrellas,
               COUNT(*) as total_resenas
        FROM comentarios
        GROUP BY sucursal_id
      ) rating ON s.sucursal_id = rating.sucursal_id
      WHERE s.activo = true AND p.activo = true
      GROUP BY s.sucursal_id, rating.promedio_estrellas, rating.total_resenas
      ORDER BY precio_promedio ASC
      LIMIT 10
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("ERROR MEJOR PRECIO:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Los productos más vendidos de la semana y se agrupan por sucursal
app.get('/sucursales/mas-vendidos', async (req, res) => {
  try {
    const query = `
      SELECT s.*, COUNT(m.movimiento_id) as total_ventas
      FROM sucursales s
      JOIN productos p ON s.sucursal_id = p.sucursal_id
      JOIN movimientos m ON p.producto_id = m.producto_id
      WHERE m.tipo = 'salida' 
        AND m.fecha >= NOW() - INTERVAL '7 days'
        AND s.activo = true
      GROUP BY s.sucursal_id
      ORDER BY total_ventas DESC
      LIMIT 10
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Las tiendas mejores calificadas
app.get('/sucursales/mejores-calificadas', async (req, res) => {
  try {
    const query = `
      SELECT s.*, 
             ROUND(AVG(c.calificacion), 1) as promedio_estrellas,
             COUNT(c.comentario_id) as total_resenas
      FROM sucursales s
      LEFT JOIN comentarios c ON s.sucursal_id = c.sucursal_id
      WHERE s.activo = true
      GROUP BY s.sucursal_id
      HAVING AVG(c.calificacion) >= 4.0
      ORDER BY promedio_estrellas DESC
      LIMIT 10
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Las tiendas con el mejor precio
app.get('/sucursales/economicas', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sucursales WHERE activo = true AND rango_precio = 1 ORDER BY nombre ASC LIMIT 10'
    );
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

// Obtener los municipios filtrados por departamento si se desea
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



// COMENTARIOS DE LOS CLIENTES DE LOS PRODUCTOS COMPRADOS

// Método JS robusto para comentarios
app.post('/comentarios', async (req, res) => {
  const { sucursal_id, usuario_id, producto_id, texto, calificacion, movimiento_id } = req.body;
  
  // Validamos que los datos esenciales no sean nulos ni 0
  if (!texto || !calificacion || !movimiento_id || !usuario_id || !producto_id) {
    return res.status(400).json({ error: 'Faltan datos obligatorios para el comentario' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO comentarios (sucursal_id, usuario_id, producto_id, texto, calificacion, movimiento_id, activo) 
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (movimiento_id) 
       DO UPDATE SET texto = EXCLUDED.texto, calificacion = EXCLUDED.calificacion, fecha = NOW(), activo = true
       RETURNING *`,
      [sucursal_id || null, usuario_id, producto_id, texto, calificacion, movimiento_id]
    );
    res.status(201).json({ mensaje: 'Comentario guardado', data: result.rows[0] });
  } catch (err) {
    console.error("ERROR DB COMENTARIO:", err.message);
    // Devolvemos el mensaje real para que puedas verlo en el Toast de la App
    res.status(500).json({ error: err.message }); 
  }
});



// INICIO DE SESION

// Login tradicional
app.post('/login', async (req, res) => {
  const identifier = req.body.correo ? req.body.correo.trim() : '';
  const { password } = req.body;

  try {
    // Buscamos en las columnas 'correo' o 'nombre'
    const result = await pool.query(
      `SELECT usuario_id, nombre, correo, rol, sucursal_id, genero, activo 
       FROM usuarios 
       WHERE (LOWER(correo) = LOWER($1) OR LOWER(nombre) = LOWER($1)) 
       AND password = crypt($2, password)`,
      [identifier, password]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      res.status(200).json({
        mensaje: 'Bienvenido',
        usuario_id: user.usuario_id,
        nombre: user.nombre,
        correo: user.correo,
        rol: user.rol,
        genero: user.genero,
        sucursal_id: user.sucursal_id,
        activo: user.activo,
        token: 'token_simulado_123' 
      });
    } else {
      res.status(401).json({ mensaje: 'Credenciales inválidas' });
    }
  } catch (err) {
    console.error("ERROR LOGIN:", err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// Login con una cuenta de Google
app.post('/login/google', async (req, res) => {
  const { nombre, correo, google_id, foto_perfil } = req.body;
  
  try {
    // Buscar si el usuario ya existe por correo
    const result = await pool.query(
      'SELECT usuario_id, nombre, correo, rol, sucursal_id, activo, foto_perfil, genero FROM usuarios WHERE correo = $1',
      [correo]
    );

    let usuario;

    if (result.rows.length > 0) {
      // Si el usuario ya existe lo retornamos
      usuario = result.rows[0];
      
      // Opcional: Se actualiza el google_id o la foto si han cambiado
      await pool.query(
        'UPDATE usuarios SET foto_perfil = COALESCE($1, foto_perfil) WHERE usuario_id = $2',
        [foto_perfil, usuario.usuario_id]
      );
    } else {
      // Si no existe lo registramos como 'cliente' por defecto y generamos una contraseña aleatoria ya que entrará por Google
      const passwordAleatoria = Math.random().toString(36).slice(-10);
      
      const insertRes = await pool.query(
        `INSERT INTO usuarios (nombre, correo, rol, activo, foto_perfil, password, genero) 
         VALUES ($1, $2, $3, $4, $5, crypt($6, gen_salt('bf', 10)), 'N') 
         RETURNING usuario_id, nombre, correo, rol, sucursal_id, activo, foto_perfil, genero`,
        [nombre, correo, 'cliente', true, foto_perfil, passwordAleatoria]
      );
      
      usuario = insertRes.rows[0];
      usuario.mensaje = "¡Bienvenido! Tu cuenta ha sido creada."; // Esto disparará el email en Android
    }

    // Enviar la respuesta al Android
    res.status(200).json({
      mensaje: usuario.mensaje || 'Bienvenido de nuevo',
      usuario_id: usuario.usuario_id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      genero: usuario.genero,
      sucursal_id: usuario.sucursal_id,
      foto_perfil: usuario.foto_perfil,
      activo: usuario.activo,
      token: 'token_google_simulado_abc'
    });

  } catch (err) {
    console.error("Error en login Google:", err.message);
    res.status(500).json({ error: 'Error interno al procesar inicio con Google' });
  }
});



// REGISTRO

// Registro de Usuario
app.post('/usuarios', async (req, res) => {
  const { 
    nombre, correo, telefono, genero, password, rol,
    nombre_tienda, direccion_tienda, departamento_tienda, municipio_tienda,
    latitud, longitud, foto_perfil, 
    foto_tienda, 
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
        'INSERT INTO sucursales (nombre, direccion, departamento, municipio, latitud, longitud, imagen_banner, activo) VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING sucursal_id',
        [nombre_tienda, direccion_tienda, departamento_tienda, municipio_tienda, latitud, longitud, foto_tienda]
      );
      sucursalId = resTienda.rows[0].sucursal_id;
    }

    await client.query(
      `INSERT INTO usuarios (
        nombre, correo, telefono, genero, password, rol, sucursal_id, activo,
        tipo_transporte, bici_marca, bici_color, bici_caracteristica,
        auto_marca_id, moto_marca_id, marca_otra,
        vehiculo_modelo, vehiculo_color, vehiculo_placa,
        vehiculo_tipo, vehiculo_anio, vehiculo_estado, foto_perfil
      ) VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf', 10)), $6, $7, true, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        nombre.trim(), 
        correo.trim().toLowerCase(), 
        telefono, 
        genero || 'N',
        password, 
        rol || 'cliente', 
        sucursalId,
        tipo_transporte, 
        bici_marca, 
        bici_color, 
        bici_caracteristica,
        auto_marca_id, 
        moto_marca_id, 
        marca_otra,
        vehiculo_modelo, 
        vehiculo_color, 
        vehiculo_placa,
        vehiculo_tipo, 
        vehiculo_anio, 
        vehiculo_estado,
        foto_perfil || null
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Usuario registrado con éxito' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("ERROR REGISTRO:", err.message);
    res.status(400).json({ error: 'El nombre o correo ya están registrados.' });
  } finally {
    client.release();
  }
});



// USUARIOS CON TARJETAS

// Obtener tarjetas del usuario
app.get('/usuarios/:usuario_id/tarjetas', async (req, res) => {
  const { usuario_id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, usuario_id, numero_enmascarado, nombre_titular, mes_expiracion, anio_expiracion, tipo, banco FROM tarjetas WHERE usuario_id = $1 ORDER BY id DESC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Agregar nueva tarjeta
app.post('/usuarios/:usuario_id/tarjetas', async (req, res) => {
  const { usuario_id } = req.params;
  const { numero, nombre_titular, mes_expiracion, anio_expiracion, tipo, banco } = req.body;

  const numero_enmascarado = `**** **** **** ${numero.slice(-4)}`;

  try {
    const result = await pool.query(
      `INSERT INTO tarjetas (usuario_id, numero_enmascarado, nombre_titular, mes_expiracion, anio_expiracion, tipo, banco) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [usuario_id, numero_enmascarado, nombre_titular, mes_expiracion, anio_expiracion, tipo, banco]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Editar tarjeta existente
app.put('/usuarios/:usuario_id/tarjetas/:id', async (req, res) => {
  const { id } = req.params;
  const { numero, nombre_titular, mes_expiracion, anio_expiracion, tipo, banco } = req.body;

  try {
    let query = `UPDATE tarjetas SET nombre_titular = $1, mes_expiracion = $2, anio_expiracion = $3, banco = $4`;
    let params = [nombre_titular, mes_expiracion, anio_expiracion, banco];

    // Si el usuario envió un número nuevo lo enmascaramos y actualizamos
    if (numero && !numero.includes('*')) {
      const numero_enmascarado = `**** **** **** ${numero.slice(-4)}`;
      query += `, numero_enmascarado = $5, tipo = $6 WHERE id = $7`;
      params.push(numero_enmascarado, tipo, id);
    } else {
      query += ` WHERE id = $5`;
      params.push(id);
    }

    await pool.query(query, params);
    res.json({ mensaje: 'Tarjeta actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Eliminar la tarjeta
app.delete('/usuarios/:usuario_id/tarjetas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tarjetas WHERE id = $1', [id]);
    res.status(200).json({ mensaje: 'Tarjeta eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// USUARIOS

app.put('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  // 1. Agregamos 'genero' a la desestructuración
  const { nombre, telefono, genero, password, foto_perfil, rol, sucursal_id, nombre_tienda, direccion_tienda, foto_tienda } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Agregamos 'genero = $3' a la consulta SQL y ajustamos los índices
    const resUser = await client.query(
      `UPDATE usuarios SET 
        nombre = $1, 
        telefono = $2, 
        genero = $3, 
        password = CASE WHEN $4::text IS NOT NULL AND $4::text != '' THEN crypt($4::text, gen_salt('bf', 10)) ELSE password END,
        foto_perfil = COALESCE(NULLIF($5::text, ''), foto_perfil)
       WHERE usuario_id = $6 RETURNING sucursal_id`,
      [nombre, telefono, genero, password || null, foto_perfil, id]
    );

    const sucursal_id_db = sucursal_id || resUser.rows[0]?.sucursal_id;

    if (rol && rol.toLowerCase() === 'vendedor' && sucursal_id_db) {
      await client.query(
        `UPDATE sucursales SET 
          nombre = $1, direccion = $2, 
          imagen_banner = CASE WHEN $3::text IS NOT NULL AND $3::text != '' THEN $3::text ELSE imagen_banner END
         WHERE sucursal_id = $4`,
        [nombre_tienda, direccion_tienda, foto_tienda, sucursal_id_db]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({ mensaje: 'Perfil actualizado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("ERROR AL ACTUALIZAR:", err.message);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});


// Cliente solicita activación de cuenta suspendida
app.post('/usuarios/solicitar-activacion', async (req, res) => {
  const { usuario_id, motivo } = req.body;
  try {
    await pool.query(
      'INSERT INTO solicitudes_activacion (usuario_id, motivo) VALUES ($1, $2)',
      [usuario_id, motivo]
    );
    res.status(201).json({ mensaje: 'Solicitud enviada' });
  } catch (err) { res.status(500).json({ error: 'Ya tienes una solicitud pendiente' }); }
});


// Evitar repetición de nombres y agrupar cantidades
app.get('/usuarios/:usuario_id/comentarios', async (req, res) => {
  const { usuario_id } = req.params;
  const { sucursal_id } = req.query;
  
  try {
    let query = `
      SELECT c.*, 
             s.nombre as sucursal_nombre,
             TO_CHAR(c.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'CST', 'DD/MM/YYYY') as fecha_fmt,
             -- Subconsulta mejorada: Agrupa por nombre y suma cantidades
             (SELECT STRING_AGG(prod_resumen, ', ')
              FROM (
                SELECT p2.nombre || ' (x' || SUM(m2.cantidad) || ')' as prod_resumen
                FROM movimientos m2
                JOIN productos p2 ON m2.producto_id = p2.producto_id
                WHERE m2.compra_id = (SELECT m3.compra_id FROM movimientos m3 WHERE m3.movimiento_id = c.movimiento_id)
                   OR (m2.movimiento_id = c.movimiento_id AND m2.compra_id IS NULL)
                GROUP BY p2.nombre
              ) sub
             ) as producto_nombre,
             (SELECT p3.imagen_url FROM productos p3 WHERE p3.producto_id = c.producto_id) as producto_foto
      FROM comentarios c
      LEFT JOIN sucursales s ON c.sucursal_id = s.sucursal_id
      WHERE c.usuario_id = $1 AND c.activo = true
    `;
    
    let params = [usuario_id];
    if (sucursal_id && sucursal_id !== 'null' && sucursal_id !== '0') {
      query += ` AND c.sucursal_id = $2`;
      params.push(sucursal_id);
    }
    query += ` ORDER BY c.fecha DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
  }
});


// DIRECCIONES DE USUARIO

// Obtener todas las direcciones de un usuario
app.get('/usuarios/:usuario_id/direcciones', async (req, res) => {
  const { usuario_id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM direcciones_usuario WHERE usuario_id = $1 ORDER BY es_principal DESC, id DESC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Agregar una nueva dirección
app.post('/usuarios/:usuario_id/direcciones', async (req, res) => {
  const { usuario_id } = req.params;
  const { nombre, direccion, latitud, longitud, referencia, es_principal } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Si esta será la principal, quitamos el check a las demás
    if (es_principal) {
      await client.query('UPDATE direcciones_usuario SET es_principal = false WHERE usuario_id = $1', [usuario_id]);
    }

    const result = await client.query(
      `INSERT INTO direcciones_usuario (usuario_id, nombre, direccion, latitud, longitud, referencia, es_principal) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [usuario_id, nombre, direccion, latitud, longitud, referencia, es_principal || false]
    );
    
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// Actualizar una dirección existente
app.put('/usuarios/:usuario_id/direcciones/:id', async (req, res) => {
  const { usuario_id, id } = req.params;
  const { nombre, direccion, latitud, longitud, referencia, es_principal } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (es_principal) {
      await client.query('UPDATE direcciones_usuario SET es_principal = false WHERE usuario_id = $1', [usuario_id]);
    }

    const result = await client.query(
      `UPDATE direcciones_usuario SET 
        nombre = $1, direccion = $2, latitud = $3, longitud = $4, referencia = $5, es_principal = $6 
       WHERE id = $7 AND usuario_id = $8 RETURNING *`,
      [nombre, direccion, latitud, longitud, referencia, es_principal, id, usuario_id]
    );

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// Eliminar una dirección
app.delete('/usuarios/:usuario_id/direcciones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM direcciones_usuario WHERE id = $1', [id]);
    res.status(200).json({ mensaje: 'Dirección eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Establecer una dirección como principal/favorita
app.patch('/usuarios/:usuario_id/direcciones/:id/principal', async (req, res) => {
  const { usuario_id, id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE direcciones_usuario SET es_principal = false WHERE usuario_id = $1', [usuario_id]);
    await client.query('UPDATE direcciones_usuario SET es_principal = true WHERE id = $2 AND usuario_id = $1', [usuario_id, id]);
    await client.query('COMMIT');
    res.json({ mensaje: 'Dirección principal actualizada' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
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


// Restablecer Contraseña con el correo del usuario
app.put('/usuarios/reset-password', async (req, res) => {
  const { correo, nuevaPassword } = req.body;

  const correoLimpio = correo ? correo.trim().toLowerCase() : null;

  if (!correoLimpio || !nuevaPassword) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const result = await pool.query(
      "UPDATE usuarios SET password = crypt($1, gen_salt('bf', 10)) WHERE LOWER(correo) = $2 RETURNING nombre, correo",
      [nuevaPassword, correoLimpio]
    );

    if (result.rows.length > 0) {
      const usuario = result.rows[0];
      
      // Intentamos enviar el correo de forma asíncrona para no bloquear la respuesta
      enviarCorreoNotificacion(usuario.correo, usuario.nombre, 'reset_password')
        .catch(emailErr => console.error("El usuario cambió su clave pero el correo falló:", emailErr));

      res.status(200).json({ mensaje: 'Contraseña actualizada con éxito' });
    } else {
      res.status(404).json({ error: 'El correo electrónico no está registrado' });
    }
  } catch (err) {
    console.error("ERROR AL ACTUALIZAR:", err.message);
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


// El vendedor elimine a un repartidor
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
    console.error("ERROR AL ELIMINAR:", err.message); // Esto saldrá en la consola de Node.js
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
    
    // Si se acepta vinculamos al repartidor a la tienda en la tabla usuarios
    if (estado === 'aceptado') {
      await client.query('UPDATE usuarios SET sucursal_id = $1 WHERE usuario_id = $2', [sucursal_id, repartidor_id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: `Solicitud ${estado}` });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});


// Configuración de la tienda para actualizar datos de la tienda
app.put('/vendedor/configuracion-tienda/:id', async (req, res) => {
  const { id } = req.params; // sucursal_id
  const { nombre, direccion, foto_tienda } = req.body;

  try {
    await pool.query(
      `UPDATE sucursales SET 
        nombre = COALESCE($1, nombre), 
        direccion = COALESCE($2, direccion), 
        imagen_banner = COALESCE($3, imagen_banner) 
       WHERE sucursal_id = $4`,
      [nombre, direccion, foto_tienda, id]
    );
    res.status(200).json({ mensaje: 'Información de la tienda actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Configuración de la tienda para actualizar el tiempo de preparación
app.patch('/vendedor/sucursal/:id/configuracion-tiempo', async (req, res) => {
  const { id } = req.params;
  const { tiempo_preparacion_min } = req.body;
  try {
    await pool.query(
      'UPDATE sucursales SET tiempo_preparacion_min = $1 WHERE sucursal_id = $2',
      [tiempo_preparacion_min, id]
    );
    res.json({ mensaje: 'Tiempo de preparación actualizado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Registrar un nuevo pago al repartidor
app.post('/vendedor/repartidores/pagar', async (req, res) => {
  const { repartidor_id, sucursal_id, monto, metodo_pago } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Forzamos la fecha sin milisegundos al insertar
    await client.query(
      `INSERT INTO pagos_repartidores (repartidor_id, sucursal_id, monto, metodo_pago, fecha) 
       VALUES ($1, $2, $3, $4, date_trunc('second', timezone('CST', now())))`,
      [repartidor_id, sucursal_id, monto, metodo_pago]
    );
    await client.query('UPDATE usuarios SET salario = $1 WHERE usuario_id = $2', [monto, repartidor_id]);
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Pago registrado con éxito' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});


// Obtener historial con formato de fecha correcto
app.get('/vendedor/repartidores/pagos/:sucursal_id', async (req, res) => {
  const { sucursal_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.pago_id, p.monto, p.metodo_pago, 
              TO_CHAR(p.fecha, 'DD/MM/YYYY HH:MI AM') as fecha,
              u.nombre as repartidor_nombre,
              u.correo as repartidor_correo
       FROM pagos_repartidores p
       JOIN usuarios u ON p.repartidor_id = u.usuario_id
       WHERE p.sucursal_id = $1 ORDER BY p.fecha DESC`, [sucursal_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      AND m.estado_entrega = 'Pendiente'  -- Esto asegura que los 'Cancelado' no salgan
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


// Actualizar estado de un pedido
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


// Actualizar estado de todo un grupo (Combo) de forma atómica
app.put('/repartidor/pedidos/grupo/:compra_id/estado', async (req, res) => {
  const { compra_id } = req.params;
  const { estado_entrega, repartidor_id, motivo_cancelacion } = req.body;
  
  try {
    // VALIDACIÓN: Verificar si el cliente ya lo canceló
    const check = await pool.query("SELECT estado_entrega FROM movimientos WHERE compra_id = $1 LIMIT 1", [compra_id]);
    if (check.rows.length > 0 && check.rows[0].estado_entrega === 'Cancelado') {
      return res.status(400).json({ error: "EL PEDIDO YA FUE CANCELADO POR EL CLIENTE" });
    }

    let query = "UPDATE movimientos SET estado_entrega = $1";
    let params = [estado_entrega, compra_id];

    if (repartidor_id) {
      query += ", repartidor_id = $3";
      params.push(repartidor_id);
    }
    
    if (motivo_cancelacion) {
        query += ", motivo_cancelacion = $4";
        params.push(motivo_cancelacion);
    }

    query += " WHERE compra_id = $2";

    await pool.query(query, params);
    res.status(200).json({ mensaje: 'ESTADO DEL GRUPO ACTUALIZADO' });
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
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


// El repartidor verá sus pagos de la tienda a la cual trabaja
app.get('/repartidor/mis-pagos/:repartidor_id', async (req, res) => {
  const { repartidor_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.*, 
              TO_CHAR(p.fecha, 'DD/MM/YYYY HH:MI AM') as fecha, 
              s.nombre as sucursal_nombre,
              u.nombre as repartidor_nombre,
              u.correo as repartidor_correo
       FROM pagos_repartidores p
       JOIN sucursales s ON p.sucursal_id = s.sucursal_id
       JOIN usuarios u ON p.repartidor_id = u.usuario_id
       WHERE p.repartidor_id = $1
       ORDER BY p.fecha DESC`,
      [repartidor_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const { sucursal_id } = req.query; 
  try {
    let query = `
      SELECT c.*, 
             u.nombre as cliente_nombre, 
             u.foto_perfil as cliente_foto,
             s.nombre as sucursal_nombre, 
             p.nombre as producto_nombre,
             (SELECT nombre FROM usuarios WHERE sucursal_id = COALESCE(c.sucursal_id, p.sucursal_id) AND rol = 'vendedor' LIMIT 1) as responsable_nombre
      FROM comentarios c
      LEFT JOIN usuarios u ON c.usuario_id = u.usuario_id
      LEFT JOIN sucursales s ON c.sucursal_id = s.sucursal_id
      LEFT JOIN productos p ON c.producto_id = p.producto_id
    `;
    
    let params = [];
    if (sucursal_id && sucursal_id !== 'null' && sucursal_id !== '0') {
      params.push(sucursal_id);
      query += ` WHERE (c.sucursal_id = $1 OR p.sucursal_id = $1)`;
    }
    query += ` ORDER BY c.fecha DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
app.get('/admin/reporte-usuarios', async (req, res) => {
  const { activo, rol, usuario_id } = req.query;
  try {
    let query = `
      SELECT u.*, 
             s.nombre as nombre_tienda, 
             s.direccion as direccion_tienda, 
             s.departamento as departamento_tienda, 
             s.municipio as municipio_tienda,
             s.latitud, s.longitud, 
             s.imagen_banner as foto_tienda  -- ESTO ES LO QUE HACE QUE CARGUE
      FROM usuarios u
      LEFT JOIN sucursales s ON u.sucursal_id = s.sucursal_id
      WHERE 1=1
    `;
    let params = [];

    if (!rol || rol === 'Todos') {
      query += ` AND u.rol != 'admin'`;
    } else {
      params.push(rol.toLowerCase());
      query += ` AND u.rol = $${params.length}`;
    }

    if (activo !== undefined && activo !== '') {
      params.push(activo === 'true');
      query += ` AND u.activo = $${params.length}`;
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
app.patch('/admin/usuarios/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body; // Solo recibimos el booleano 'activo'

  try {
    await pool.query(
      'UPDATE usuarios SET activo = $1 WHERE usuario_id = $2',
      [activo, id]
    );
    res.status(200).json({ mensaje: `Usuario ${activo ? 'activado' : 'desactivado'} correctamente` });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    // Obtener conteos base (Globales por defecto)
    let totalTiendasQuery = 'SELECT COUNT(*) FROM sucursales WHERE activo = true';
    let deptoCountQuery = 'SELECT COUNT(DISTINCT UPPER(TRIM(departamento))) FROM sucursales WHERE activo = true';
    let munCountQuery = 'SELECT COUNT(DISTINCT UPPER(TRIM(municipio))) FROM sucursales WHERE activo = true';
    let params = [];

    // Filtrado por Departamento (Corregido: departamentosid y comparación robusta)
    if (departamento_id && departamento_id !== '0') {
      const dInfo = await pool.query('SELECT depar FROM departamentos WHERE departamentosid = $1', [departamento_id]);
      if (dInfo.rows.length > 0) {
        const deptoNombre = dInfo.rows[0].depar;
        // Comparación insensible a acentos y mayúsculas
        const filter = ' AND (departamento ILIKE $1 OR translate(UPPER(TRIM(departamento)), \'ÁÉÍÓÚ\', \'AEIOU\') = translate(UPPER(TRIM($1)), \'ÁÉÍÓÚ\', \'AEIOU\'))';
        totalTiendasQuery += filter;
        munCountQuery += filter;
        params.push(deptoNombre);
      }
    }

    const totalRes = await pool.query(totalTiendasQuery, params);
    const deptoCountRes = await pool.query(deptoCountQuery);
    const munCountRes = await pool.query(munCountQuery, params);

    // Obtener los datos para el gráfico (siendo Normalizados)
    let chartData;
    if (departamento_id && departamento_id !== '0') {
      const res = await pool.query(`
        SELECT UPPER(TRIM(municipio)) as nombre, COUNT(*) as cantidad,
               ROUND((COUNT(*)::numeric / NULLIF($2, 0)) * 100, 2) as porcentaje
        FROM sucursales 
        WHERE activo = true AND (departamento ILIKE $1 OR translate(UPPER(TRIM(departamento)), 'ÁÉÍÓÚ', 'AEIOU') = translate(UPPER(TRIM($1)), 'ÁÉÍÓÚ', 'AEIOU'))
        GROUP BY UPPER(TRIM(municipio)) ORDER BY cantidad DESC
      `, [params[0], totalRes.rows[0].count]);
      chartData = res.rows;
    } else {
      const res = await pool.query(`
        SELECT UPPER(TRIM(departamento)) as nombre, COUNT(*) as cantidad, 
               ROUND((COUNT(*)::numeric / NULLIF($1, 0)) * 100, 2) as porcentaje
        FROM sucursales WHERE activo = true
        GROUP BY UPPER(TRIM(departamento)) ORDER BY cantidad DESC
      `, [totalRes.rows[0].count]);
      chartData = res.rows;
    }

    res.json({
      total: parseInt(totalRes.rows[0].count),
      total_deptos: parseInt(deptoCountRes.rows[0].count),
      total_muns: parseInt(munCountRes.rows[0].count),
      por_departamento: (departamento_id && departamento_id !== '0') ? [] : chartData,
      por_municipio: (departamento_id && departamento_id !== '0') ? chartData : []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Censo Nacional: Filtros
app.get('/admin/censo-nacional', async (req, res) => {
  const { departamento_id, municipio } = req.query;
  try {
    // Obtener por una consulta los datos de las tiendas y sus vendedores
    let query = `
      SELECT 
        s.sucursal_id,
        UPPER(s.nombre) as tienda,
        UPPER(s.departamento) as departamento,
        UPPER(s.municipio) as municipio,
        s.direccion,
        COALESCE(u.nombre, 'SIN ASIGNAR') as responsable,
        COALESCE(u.telefono, 'N/A') as telefono,
        COALESCE(u.correo, 'N/A') as correo,
        s.activo
      FROM sucursales s
      LEFT JOIN usuarios u ON s.sucursal_id = u.sucursal_id AND u.rol = 'vendedor'
      WHERE s.activo = true
    `;
    
    let params = [];
    
    // Se filtra por departamento
    if (departamento_id && departamento_id !== '0') {
      const dInfo = await pool.query('SELECT depar FROM departamentos WHERE departamentosid = $1', [departamento_id]);
      if (dInfo.rows.length > 0) {
        params.push(dInfo.rows[0].depar);
        // Se compara acentos y mayusculas insensiblemente para evitar problemas de datos vacios
        query += ` AND (s.departamento ILIKE $${params.length} OR translate(UPPER(TRIM(s.departamento)), 'ÁÉÍÓÚ', 'AEIOU') = translate(UPPER(TRIM($${params.length})), 'ÁÉÍÓÚ', 'AEIOU'))`;
      }
    }
    
    // Se filtra por municipio y se compara acentos y mayusculas insensiblemente para evitar problemas de datos vacios
    if (municipio && municipio !== '' && municipio !== 'Todos los Municipios') {
      params.push(municipio);
      // Se compara acentos y mayusculas insensiblemente para evitar problemas de datos vacios
      query += ` AND (s.municipio ILIKE $${params.length} OR translate(UPPER(TRIM(s.municipio)), 'ÁÉÍÓÚ', 'AEIOU') = translate(UPPER(TRIM($${params.length})), 'ÁÉÍÓÚ', 'AEIOU'))`;
    }

    // Se ordena por departamento y municipio ascendente
    query += ` ORDER BY s.departamento ASC, s.municipio ASC, s.nombre ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Admin obtiene solicitudes (Pendientes y Rechazadas) con Foto de Perfil
app.get('/admin/solicitudes-activacion', async (req, res) => {
  try {
    const query = `
      SELECT 
        s.solicitud_id, s.usuario_id, s.motivo, s.estado, s.mensaje_admin, 
        TO_CHAR(s.fecha_solicitud, 'DD/MM/YYYY HH:MI AM') as fecha_solicitud,
        u.nombre as nombre_usuario, u.correo as correo_usuario, 
        u.telefono as telefono_usuario, u.activo as usuario_activo,
        u.foto_perfil
      FROM solicitudes_activacion s
      JOIN usuarios u ON s.usuario_id = u.usuario_id
      WHERE s.estado IN ('pendiente', 'rechazada', 'aceptada')
      ORDER BY s.fecha_solicitud DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) { 
    console.error("ERROR ACTIVACIONES:", err.message);
    res.status(500).json({ error: 'Error al obtener solicitudes' }); 
  }
});


// Admin procesa la solicitud (Activa cuenta y guarda mensaje)
app.put('/admin/solicitudes-activacion/:id', async (req, res) => {
  const { id } = req.params;
  const { estado, mensaje_admin, usuario_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Actualizar estado de la solicitud
    await client.query(
      'UPDATE solicitudes_activacion SET estado = $1, mensaje_admin = $2, fecha_resolucion = NOW() WHERE solicitud_id = $3',
      [estado, mensaje_admin, id]
    );
    
    // Si se acepta (maneja ambos términos), activar al usuario
    if (estado === 'aceptada' || estado === 'aceptado') {
      await client.query('UPDATE usuarios SET activo = true WHERE usuario_id = $1', [usuario_id]);
    }
    
    await client.query('COMMIT');
    res.json({ mensaje: `Cuenta ${(estado === 'aceptada' || estado === 'aceptado') ? 'activada' : 'rechazada'}` });
  } catch (err) { 
    await client.query('ROLLBACK'); 
    res.status(500).json({ error: err.message }); 
  } finally { 
    client.release(); 
  }
});


// Eliminar un comentario por el Administrador (Borrado lógico)
app.delete('/admin/comentarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Marcamos como inactivo para que el cliente vea que fue eliminado por moderación
    await pool.query('UPDATE comentarios SET activo = false WHERE comentario_id = $1', [id]);
    res.status(200).json({ mensaje: 'Comentario eliminado por el administrador' });
  } catch (err) {
    console.error("ERROR AL ELIMINAR COMENTARIO:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// El admin obtiene las peticiones
app.get('/admin/soporte', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.soporte_id, s.mensaje, s.usuario_id, s.estado, s.respuesta_admin,
             u.nombre as usuario_nombre, u.correo as usuario_correo, 
             u.rol as usuario_rol, u.foto_perfil,
             TO_CHAR(s.fecha AT TIME ZONE 'America/El_Salvador', 'DD/MM/YYYY HH12:MI AM') as fecha
      FROM soporte s
      JOIN usuarios u ON s.usuario_id = u.usuario_id
      WHERE u.rol != 'admin'
      ORDER BY s.fecha DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
  }
});


// El admin puede actualizar el estado de la petición. Maneja: 'recibida', 'solucionada', 'cancelada'
app.put('/admin/soporte/:id', async (req, res) => {
  const { id } = req.params;
  const { estado, respuesta_admin } = req.body; // Ahora recibe la respuesta también

  try {
    const query = `
      UPDATE soporte 
      SET estado = $1, respuesta_admin = $2 
      WHERE soporte_id = $3 
      RETURNING *
    `;
    const result = await pool.query(query, [estado.toLowerCase(), respuesta_admin, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'PETICIÓN NO ENCONTRADA' });
    }

    res.json({ mensaje: 'PETICIÓN ACTUALIZADA CORRECTAMENTE' });
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
  }
});



// SOPORTE TÉCNICO

// El usuario envia el mensaje
app.post('/soporte', async (req, res) => {
  const { usuario_id, mensaje } = req.body;
  if (!usuario_id || !mensaje) return res.status(400).json({ error: 'Faltan datos' });

  try {
    await pool.query(
      "INSERT INTO soporte (usuario_id, mensaje, estado) VALUES ($1, $2, 'pendiente')",
      [usuario_id, mensaje]
    );
    res.status(201).json({ mensaje: 'PETICIÓN ENVIADA CON ÉXITO' });
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
  }
});


// Se obtiene las peticiones de un usuario específico (para el cliente)
app.get('/soporte/mis-mensajes/:usuario_id', async (req, res) => {
  const { usuario_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT soporte_id, mensaje, estado, respuesta_admin,
             TO_CHAR(fecha AT TIME ZONE 'America/El_Salvador', 'DD/MM/YYYY HH12:MI AM') as fecha
      FROM soporte 
      WHERE usuario_id = $1
      ORDER BY fecha DESC
    `, [usuario_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message.toUpperCase() });
  }
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
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id, fecha_caducidad, hora_caducidad } = req.body;  
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id, fecha_caducidad, hora_caducidad) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *', 
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, usuario_id, fecha_caducidad || null, hora_caducidad || null]
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
  const { codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, fecha_caducidad, hora_caducidad} = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET codigo_barras = $1, nombre = $2, categoria_id = $3, precio = $4, costo = $5, stock = $6, imagen_url = $7, activo = $8, sucursal_id = $9, fecha_caducidad = $10, hora_caducidad = $11 WHERE producto_id = $12 RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, costo, stock, imagen_url, activo, sucursal_id, fecha_caducidad, hora_caducidad, id]
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


// Los productos más vendidos de la semana con la información de la tienda
app.get('/productos/mas-vendidos', async (req, res) => {
  try {
    const query = `
      SELECT p.*, s.nombre as sucursal_nombre, s.imagen_banner as sucursal_foto
      FROM productos p
      JOIN (
        SELECT producto_id, COUNT(*) as total_ventas
        FROM movimientos
        WHERE tipo = 'salida' 
          AND fecha >= NOW() - INTERVAL '7 days'
        GROUP BY producto_id
      ) m ON p.producto_id = m.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      WHERE p.activo = true AND s.activo = true
      ORDER BY m.total_ventas DESC
      LIMIT 10
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("ERROR PRODUCTOS TOP:", err.message);
    res.status(500).json({ error: err.message });
  }
});



// VENTAS

// Registro con asignación de repartidor
app.post('/ventas', async (req, res) => {
  const { producto_id, usuario_id, cantidad, metodoPago, monto_recibido, vuelto_entregado, entregaDomicilio, direccionEntrega, telefonoContacto } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prodRes = await client.query("SELECT precio FROM productos WHERE producto_id = $1", [producto_id]);
    const precioU = prodRes.rows[0].precio;
    const totalVenta = precioU * cantidad;

    await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [cantidad, producto_id]);
    await client.query(
      `INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, total, fecha, metodo_pago, monto_recibido, vuelto_entregado, entrega_domicilio, direccion_entrega, telefono_contacto, estado_entrega) 
       VALUES ($1, $2, 'salida', $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11)`,
      [producto_id, usuario_id, cantidad, totalVenta, metodoPago, monto_recibido || 0, vuelto_entregado || 0, entregaDomicilio, direccionEntrega, telefonoContacto, entregaDomicilio ? 'Pendiente' : 'Completado']
    );
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Venta registrada" });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});


// Historial de ventas - Método Corregido
app.get('/ventas/historial', async (req, res) => {
  const { usuario_id, sucursal_id } = req.query;
  
  // Normalizar parámetros para evitar errores con '0' o 'null' strings
  const pUsuario = (usuario_id && usuario_id !== '0' && usuario_id !== 'null') ? usuario_id : null;
  const pSucursal = (sucursal_id && sucursal_id !== '0' && sucursal_id !== 'null') ? sucursal_id : null;

  try {
    const result = await pool.query(`
      SELECT 
        m.compra_id as movimiento_id_str,
        MAX(m.movimiento_id) as movimiento_id,
        MAX(p.producto_id) as producto_id,
        MAX(p.sucursal_id) as sucursal_id,
        (SELECT STRING_AGG(p2.nombre || ' (x' || sub.total_cant || ')', ', ')
         FROM (
           SELECT m2.producto_id, SUM(m2.cantidad) as total_cant
           FROM movimientos m2
           WHERE (m.compra_id IS NOT NULL AND m2.compra_id = m.compra_id)
              OR (m.compra_id IS NULL AND m2.movimiento_id = MAX(m.movimiento_id))
           GROUP BY m2.producto_id
         ) sub
         JOIN productos p2 ON sub.producto_id = p2.producto_id
        ) as producto_nombre,
        SUM(m.cantidad) as cantidad,
        SUM(m.cantidad * p.precio) as total,
        SUM(m.cantidad * (p.precio - COALESCE(p.costo, 0))) as ganancia_neta,
        MAX(m.fecha) as fecha,
        MAX(s.nombre) as sucursal_nombre,
        MAX(m.estado_entrega) as estado_entrega,
        -- CORRECCIÓN: Solo es Consumidor Final si NO hay un usuario cliente o si es una venta anónima de vendedor
        CASE
          WHEN u_cli.usuario_id IS NULL OR MAX(u_cli.rol) = 'vendedor' THEN 'Consumidor Final'
          ELSE MAX(u_cli.nombre)
        END as usuario_nombre,
        MAX(u_cli.correo) as usuario_correo,
        -- CORRECCIÓN: Priorizamos el teléfono del pedido, si no existe, usamos el del perfil del cliente
        COALESCE(NULLIF(MAX(m.telefono_contacto), ''), MAX(u_cli.telefono)) as telefono_contacto,
        MAX(s.departamento) as departamento,
        MAX(s.municipio) as municipio
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      JOIN sucursales s ON p.sucursal_id = s.sucursal_id
      LEFT JOIN usuarios u_cli ON m.usuario_id = u_cli.usuario_id
      WHERE m.tipo = 'salida'
      AND ($1::integer IS NULL OR m.usuario_id = $1)
      AND ($2::integer IS NULL OR p.sucursal_id = $2)
      AND (m.entrega_domicilio = false OR m.estado_entrega = 'Entregado')
      GROUP BY m.compra_id, m.fecha
      ORDER BY fecha DESC
    `, [pUsuario, pSucursal]);
    res.json(result.rows);
  } catch (err) { 
    console.error("ERROR API HISTORIAL:", err.message);
    res.status(500).json({ error: err.message }); 
  }
});


// Registro de ventas multiple con el Carrito
app.post('/ventas/multiple', async (req, res) => {
  const { items, usuario_id, metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, repartidor_id } = req.body;
  const client = await pool.connect();
  const compra_id = `TRX-${Date.now()}`; 

  try {
    await client.query('BEGIN');
    
    // Obtenemos el tiempo de preparación configurado por la tienda
    const sucursalRes = await client.query(
      "SELECT tiempo_preparacion_min FROM sucursales WHERE sucursal_id = $1", 
      [items[0].sucursal_id]
    );
    const prepMin = sucursalRes.rows[0]?.tiempo_preparacion_min || 15;
    
    // Calculamos el tiempo prometido (Ahora + Preparación + 10 min margen trayecto)
    const tiempoPrometido = Date.now() + (prepMin + 10) * 60000;

    for (const item of items) {
      const prodRes = await client.query("SELECT precio FROM productos WHERE producto_id = $1", [item.producto_id]);
      const precioUnitario = prodRes.rows[0].precio;
      const totalItem = precioUnitario * item.cantidad;

      await client.query('UPDATE productos SET stock = stock - $1 WHERE producto_id = $2', [item.cantidad, item.producto_id]);
      
      // Insertamos el tiempo_prometido en el movimiento
      await client.query(
        `INSERT INTO movimientos 
        (producto_id, usuario_id, tipo, cantidad, total, fecha, metodo_pago, entrega_domicilio, direccion_entrega, telefono_contacto, estado_entrega, repartidor_id, compra_id, tiempo_prometido) 
        VALUES ($1, $2, 'salida', $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          item.producto_id, usuario_id, item.cantidad, totalItem, 
          metodoPago, entregaDomicilio, direccionEntrega, telefonoContacto, 
          entregaDomicilio ? 'Pendiente' : 'Completado', 
          repartidor_id || null, compra_id, tiempoPrometido
        ]
      );
    }
    
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Compra realizada", compra_id, tiempoPrometido });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});


// Procesar la decisión: Aceptar o Declinar cancelación (Afecta a todo el grupo)
app.post('/ventas/:id/procesar-cancelacion', async (req, res) => {
  const { id } = req.params;
  const { accion } = req.body; 
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resMov = await client.query("SELECT compra_id FROM movimientos WHERE movimiento_id = $1", [id]);
    const { compra_id } = resMov.rows[0];

    if (accion === 'aceptar') {
      const productos = await client.query("SELECT producto_id, cantidad FROM movimientos WHERE compra_id = $1", [compra_id]);
      for (const p of productos.rows) {
        await client.query("UPDATE productos SET stock = stock + $1 WHERE producto_id = $2", [p.cantidad, p.producto_id]);
      }
      await client.query(
        "UPDATE movimientos SET estado_entrega = 'Cancelado', solicitud_cancelacion = false WHERE compra_id = $1", 
        [compra_id]
      );
    } else {
      await client.query("UPDATE movimientos SET solicitud_cancelacion = false WHERE compra_id = $1", [compra_id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: "Procesado para todo el grupo" });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});


// Editar o solicitar cancelacion desde el cliente
app.put('/ventas/:id/detalles', async (req, res) => {
  const { id } = req.params;
  const { direccion_entrega, telefono_contacto, cantidad, total } = req.body;
  
  try {
    // Si la cantidad es 0, el cliente quiere eliminar este producto del pedido
    if (cantidad === 0) {
      // 1. Buscamos qué producto es y cuánto tenía para devolver el stock
      const mov = await pool.query("SELECT producto_id, cantidad FROM movimientos WHERE movimiento_id = $1", [id]);
      
      if (mov.rows.length > 0) {
        await pool.query(
          "UPDATE productos SET stock = stock + $1 WHERE producto_id = $2", 
          [mov.rows[0].cantidad, mov.rows[0].producto_id]
        );
      }

      // Eliminamos el registro del pedido (movimiento)
      await pool.query(
        "DELETE FROM movimientos WHERE movimiento_id = $1 AND estado_entrega = 'Pendiente'", 
        [id]
      );
      
      return res.json({ mensaje: "Producto eliminado del pedido y stock devuelto" });
    }

    // LÓGICA DE ACTUALIZACIÓN (Si cantidad > 0)
    const result = await pool.query(
      `UPDATE movimientos 
       SET direccion_entrega = COALESCE($1, direccion_entrega), 
           telefono_contacto = COALESCE($2, telefono_contacto),
           cantidad = $3,
           total = $4
       WHERE movimiento_id = $5 AND estado_entrega = 'Pendiente' 
       RETURNING *`,
      [direccion_entrega, telefono_contacto, cantidad, total, id]
    );

    if (result.rowCount > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(400).json({ error: "No se puede editar: el pedido ya no está Pendiente" });
    }
  } catch (err) {
    console.error("ERROR EDICIÓN:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Solicitar cancelación al repartidor: Si SOLO está 'En Camino'
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


// Ahora busca el compra_id y cancela todo el combo devolviendo el stock de cada item.
app.post('/ventas/:id/cancelar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscamos el compra_id para identificar a todo el grupo de productos
    const infoRes = await client.query("SELECT compra_id FROM movimientos WHERE movimiento_id = $1", [id]);
    if (infoRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Pedido no encontrado" });
    }
    const { compra_id } = infoRes.rows[0];

    // Devolvemos el stock de TODOS los productos del grupo que estaban pendientes
    const productosGrupo = await client.query(
      "SELECT producto_id, cantidad FROM movimientos WHERE compra_id = $1 AND estado_entrega = 'Pendiente'", 
      [compra_id]
    );

    for (const item of productosGrupo.rows) {
      await client.query(
        "UPDATE productos SET stock = stock + $1 WHERE producto_id = $2", 
        [item.cantidad, item.producto_id]
      );
    }

    // Marcamos TODO EL GRUPO como Cancelado
    await client.query(
      "UPDATE movimientos SET estado_entrega = 'Cancelado', motivo_cancelacion = 'Cancelado por el cliente' WHERE compra_id = $1", 
      [compra_id]
    );

    await client.query('COMMIT');
    res.json({ mensaje: "Pedido y todos sus productos cancelados con éxito" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// Se obtiene el detalle de la venta para el repartidor
app.get('/ventas/:id/seguimiento', async (req, res) => {
  const { id } = req.params;
  try {
    // Buscamos el ID de la transacción
    const baseReq = await pool.query("SELECT compra_id FROM movimientos WHERE movimiento_id = $1", [id]);
    if (baseReq.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    const compraId = baseReq.rows[0].compra_id;

    // Consulta corregida: Traemos al cliente (u_cli) y al repartidor (u_rep)
    const query = `
      SELECT m.*, p.nombre as producto_nombre, p.precio as precio_unitario,
             m.tiempo_prometido,
             u_cli.nombre as usuario_nombre, -- <--- ESTO TRAE EL NOMBRE DEL CLIENTE
             u_rep.nombre as repartidor_nombre, u_rep.foto_perfil as repartidor_foto,
             u_rep.telefono as repartidor_telefono, u_rep.tipo_transporte
      FROM movimientos m
      JOIN productos p ON m.producto_id = p.producto_id
      LEFT JOIN usuarios u_cli ON m.usuario_id = u_cli.usuario_id
      LEFT JOIN usuarios u_rep ON m.repartidor_id = u_rep.usuario_id
      WHERE ${compraId ? 'm.compra_id = $1' : 'm.movimiento_id = $1'}
    `;
    
    const result = await pool.query(query, [compraId || id]);
    res.json(result.rows); 
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});


// El cliente vera solo pedidos activos de una tienda específica si tiene otros pedidos en otras tiendas
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



// CAJA DEL VENDEDOR

// Abrir caja (Registrar el monto inicial de efectivo)
app.post('/caja/apertura', async (req, res) => {
  const { vendedor_id, sucursal_id, monto_apertura } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO cajas (vendedor_id, sucursal_id, monto_apertura, estado) 
       VALUES ($1, $2, $3, 'Abierta') RETURNING *`,
      [vendedor_id, sucursal_id, monto_apertura]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Obtener estado actual y el efectivo total (Para el POS)
app.get('/caja/estado/:vendedor_id', async (req, res) => {
  try {
    // Buscamos la caja abierta
    const cajaRes = await pool.query(
      "SELECT * FROM cajas WHERE vendedor_id = $1 AND estado = 'Abierta' ORDER BY fecha_apertura DESC LIMIT 1",
      [req.params.vendedor_id]
    );

    if (cajaRes.rows.length === 0) {
      return res.status(404).json({ mensaje: "Caja no iniciada" });
    }

    const caja = cajaRes.rows[0];

    // Calculamos el total de ventas en efectivo desde que se abrió la caja
    const ventasRes = await pool.query(
      `SELECT COALESCE(SUM(cantidad * precio_unitario), 0) as total_efectivo
       FROM movimientos m
       JOIN productos p ON m.producto_id = p.producto_id
       WHERE m.usuario_id = $1 
       AND m.metodo_pago = 'Efectivo' 
       AND m.fecha >= $2`,
      [req.params.vendedor_id, caja.fecha_apertura]
    );

    const ventasEfectivo = parseFloat(ventasRes.rows[0].total_efectivo);
    const efectivoActual = parseFloat(caja.monto_apertura) + ventasEfectivo;

    res.json({
      ...caja,
      ventas_efectivo: ventasEfectivo,
      efectivo_total_sistema: efectivoActual // Este es el valor que el POS debe mostrar
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Cerrar Caja con registro de ventas final
app.put('/caja/cierre/:caja_id', async (req, res) => {
  const { monto_cierre, ventas_efectivo } = req.body;
  try {
    await pool.query(
      `UPDATE cajas SET 
        monto_cierre = $1, 
        ventas_efectivo = $2,
        fecha_cierre = NOW(), 
        estado = 'Cerrada' 
       WHERE caja_id = $3`,
      [monto_cierre, ventas_efectivo, req.params.caja_id]
    );
    res.json({ mensaje: "Caja cerrada y guardada en el historial" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Historial con corrección de zona horaria para El Salvador
app.get('/caja/historial/:vendedor_id', async (req, res) => {
  const { fecha } = req.query;
  try {
    let query = `
      SELECT 
        caja_id, monto_apertura, monto_cierre, ventas_efectivo,
        (monto_apertura + ventas_efectivo) as monto_esperado,
        (monto_cierre - (monto_apertura + ventas_efectivo)) as diferencia,
        -- Conversión crucial para que la hora coincida con El Salvador
        TO_CHAR(fecha_apertura AT TIME ZONE 'UTC' AT TIME ZONE 'CST', 'DD/MM/YYYY') as fecha_apertura_fmt,
        TO_CHAR(fecha_apertura AT TIME ZONE 'UTC' AT TIME ZONE 'CST', 'HH12:MI AM') as hora_apertura_fmt,
        TO_CHAR(fecha_cierre AT TIME ZONE 'UTC' AT TIME ZONE 'CST', 'DD/MM/YYYY') as fecha_cierre_fmt,
        TO_CHAR(fecha_cierre AT TIME ZONE 'UTC' AT TIME ZONE 'CST', 'HH12:MI AM') as hora_cierre_fmt,
        estado
      FROM cajas 
      WHERE vendedor_id = $1 AND estado = 'Cerrada'
    `;

    let params = [req.params.vendedor_id];

    if (fecha && fecha !== '') {
      query += " AND (fecha_apertura::date = $2 OR fecha_cierre::date = $2)";
      params.push(fecha);
    }

    query += " ORDER BY fecha_cierre DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Reporte General de Caja (Estadísticas rápidas)
app.get('/caja/reporte-resumen/:vendedor_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_cierres,
        SUM(monto_cierre - monto_apertura) as ingresos_netos_efectivo,
        AVG(monto_cierre - (monto_apertura + ventas_efectivo)) as promedio_desfase
       FROM cajas 
       WHERE vendedor_id = $1 AND estado = 'Cerrada'`,
      [req.params.vendedor_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Mensaje de que la API esta funcionando en RENDER
app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

// Iniciar el servidor en el puerto 3000
const PORT = process.env.PORT || 3000;

// Iniciar el servidor con el numero de puerto
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));