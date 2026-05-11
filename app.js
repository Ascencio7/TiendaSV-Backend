import express from 'express';
import pkg from 'pg';
import cors from 'cors';

const { Pool } = pkg;

const app = express();

// Medios de comunicacion de la API
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Conexion a Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Confirmacion de conexion a Supabase
pool.connect()
  .then(client => {
    console.log("✅ Conectado a Supabase");
    client.release();
  })
  .catch(err => {
    console.error("❌ Error conectando a Supabase:", err);
  });

// Ruta base de la API para pruebas
app.get('/', (req, res) => {
  res.status(200).json({ mensaje: 'API funcionando 🚀' });
});