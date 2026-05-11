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

app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT usuario_id, nombre, correo, rol FROM usuarios WHERE correo = $1 AND password = $2',
      [correo, password]
    );

    if (result.rows.length > 0) {
      res.status(200).json({
        mensaje: 'Bienvenido',
        usuario_id: result.rows[0].usuario_id,
        nombre: result.rows[0].nombre,
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

// Crear producto (CON IMAGEN)
app.post('/productos', async (req, res) => {
  const { codigo_barras, nombre, categoria_id, precio, stock, imagen_url } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO productos (codigo_barras, nombre, categoria_id, precio, stock, imagen_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [codigo_barras, nombre, categoria_id, precio, stock, imagen_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Actualizar producto (CON IMAGEN)
app.put('/productos/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, categoria_id, precio, stock, imagen_url } = req.body;
  try {
    const result = await pool.query(
      'UPDATE productos SET nombre = $1, categoria_id = $2, precio = $3, stock = $4, imagen_url = $5 WHERE producto_id = $6 RETURNING *',
      [nombre, categoria_id, precio, stock, imagen_url, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/productos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM productos WHERE producto_id = $1', [id]);
    res.status(204).send();
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

app.get('/', (req, res) => res.status(200).json({ mensaje: 'API funcionando 🚀' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));