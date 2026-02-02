import express from "express";
import pkg from "pg";
import "dotenv/config";

const { Pool } = pkg;

/* 1️⃣ Crear la app */
const app = express();
app.use(express.json());

/* 2️⃣ Conexión a Postgres */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* 3️⃣ Ruta de prueba */
app.get("/", (req, res) => {
  res.send("API OK");
});

/* ================== HELPERS ================== */
function normEtapa(x) {
  const e = String(x || "").trim();
  return e ? e : "Ingreso";
}

function getCode(req) {
  // Soporta ?code= , JSON body {code:""} y form-data simple
  return String(req.query.code || req.body?.code || "").trim();
}

function getEtapa(req) {
  return normEtapa(req.query.etapa || req.body?.etapa || "Ingreso");
}

/**
 * Reglas:
 * - Si empieza con letra: tipo = Letra + 1 dígito (A1..Z9), serial = resto numérico
 * - Si empieza con número: tipo = 2 dígitos, serial = resto numérico
 */
function parseCode(codeRaw) {
  const code = String(codeRaw || "").trim();

  // Letra + 1 dígito + serial numérico
  // Ej: A1123456 => tipo=A1 serial=123456
  const m1 = code.match(/^([A-Za-z]\d)(\d+)$/);
  if (m1) {
    const tipo = m1[1].toUpperCase();
    const serial = m1[2];
    const barcode = code.toUpperCase();
    return { tipo, serial, barcode };
  }

  // 2 dígitos + serial numérico
  // Ej: 60123456 => tipo=60 serial=123456
  const m2 = code.match(/^(\d{2})(\d+)$/);
  if (m2) {
    const tipo = m2[1];
    const serial = m2[2];
    const barcode = code;
    return { tipo, serial, barcode };
  }

  throw new Error("code inválido: usa 00+serial o A1+serial");
}

/* 4️⃣ FUNCIÓN REUTILIZABLE para registrar código */
async function registrarCodigo(codeInput, etapaInput, res) {
  let parsed;
  try {
    parsed = parseCode(codeInput);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const etapa = normEtapa(etapaInput);
  const { tipo, serial, barcode } = parsed;

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

    // Escáner/API: form y form_id quedan NULL (no se insertan)
    const insert = await client.query(
      `INSERT INTO registros
       (barcode, tipo, serial, variedad, bloque, tamano, tallos, etapa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (barcode) DO NOTHING
       RETURNING barcode`,
      [
        barcode,
        tipo,
        serial,
        t.variedad,
        t.bloque,
        t.tamano,  // puede ser 'NA' o null según tu tabla
        t.tallos,
        etapa,
      ]
    );

    await client.query("COMMIT");

    if (insert.rowCount === 0) {
      return res.json({ ok: true, status: "YA_REGISTRADO", code: barcode, etapa });
    }

    return res.json({ ok: true, status: "OK", code: barcode, etapa });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
}

/* 5️⃣ POST (PowerShell / batch) */
app.post("/api/registrar_code", async (req, res) => {
  const code = getCode(req);
  const etapa = getEtapa(req);
  await registrarCodigo(code, etapa, res);
});

/* 6️⃣ GET (navegador / lector que abre URL) */
app.get("/api/registrar_code", async (req, res) => {
  const code = getCode(req);
  const etapa = getEtapa(req);
  await registrarCodigo(code, etapa, res);
});

/* 7️⃣ Arrancar servidor */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor listo en puerto", PORT);
});