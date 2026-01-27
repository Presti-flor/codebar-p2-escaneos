import express from "express";
import pkg from "pg";
import "dotenv/config";

const { Pool } = pkg;

/* 1️⃣ Crear la app PRIMERO */
const app = express();
app.use(express.json());

/* 2️⃣ Conexión a Postgres */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* 3️⃣ Ruta de prueba */
app.get("/", (req, res) => {
  res.send("API OK");
});

/* 4️⃣ FUNCIÓN REUTILIZABLE para registrar código */
async function registrarCodigo(code, res) {
  if (!/^\d{3,}$/.test(code)) {
    return res.status(400).json({ ok: false, error: "code inválido" });
  }

  const tipo = code.slice(0, 2);
  const serial = code.slice(2);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tipoRow = await client.query(
      "SELECT * FROM tipos_variedad WHERE tipo = $1",
      [tipo]
    );

    if (tipoRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "tipo no existe", tipo });
    }

    const t = tipoRow.rows[0];

    const insert = await client.query(
      `INSERT INTO registros
       (barcode, tipo, serial, variedad, bloque, tamano, tallos)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (barcode) DO NOTHING
       RETURNING barcode`,
      [code, tipo, serial, t.variedad, t.bloque, t.tamano, t.tallos]
    );

    await client.query("COMMIT");

    if (insert.rowCount === 0) {
      return res.json({ ok: true, status: "YA_REGISTRADO", code });
    }

    return res.json({ ok: true, status: "OK", code });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
}

/* 5️⃣ POST (para PowerShell y batch) */
app.post("/api/registrar_code", async (req, res) => {
  const code = (req.query.code || "").trim();
  await registrarCodigo(code, res);
});

/* 6️⃣ GET (para navegador / lector que abre URL) */
app.get("/api/registrar_code", async (req, res) => {
  const code = (req.query.code || "").trim();
  await registrarCodigo(code, res);
});

/* 7️⃣ Arrancar servidor */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor listo en puerto", PORT);
});
