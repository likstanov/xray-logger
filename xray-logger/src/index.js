import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { createDecipheriv } from 'crypto';
import { z } from 'zod';

dotenv.config();

const PORT = process.env.PORT || 8080;
const ENCRYPTION_KEY_BASE64 = process.env.ENCRYPTION_KEY_BASE64;
if (!ENCRYPTION_KEY_BASE64) { console.error('ENCRYPTION_KEY_BASE64 is required'); process.exit(1); }
const KEY = Buffer.from(ENCRYPTION_KEY_BASE64, 'base64');
if (KEY.length !== 32) { console.error('ENCRYPTION_KEY_BASE64 must decode to 32 bytes (AES-256)'); process.exit(1); }

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'xray_logger',
  user: process.env.PGUSER || 'xraylogger',
  password: process.env.PGPASSWORD || 'password',
  max: 10,
  idleTimeoutMillis: 30000,
});
pool.on('connect', async (client) => { await client.query("SET TIME ZONE 'UTC'"); });

/** ---------------- Авто-инициализация схемы ---------------- */
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS xray_logs (
  xray_user    VARCHAR(255) NOT NULL,
  user_ip      INET         NOT NULL,
  target       TEXT         NOT NULL,
  port         INTEGER      NOT NULL,
  protocol_in  VARCHAR(3)   NULL CHECK (protocol_in IN ('tcp','udp')),
  protocol_out VARCHAR(3)   NOT NULL CHECK (protocol_out IN ('tcp','udp')),
  node_ip      INET         NOT NULL,
  node_name    VARCHAR(64)  NOT NULL,
  inbound      VARCHAR(64)  NOT NULL,
  outbound     VARCHAR(64)  NOT NULL,
  datetime     TIMESTAMPTZ  NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xray_logs_port_range') THEN
    ALTER TABLE xray_logs
      ADD CONSTRAINT xray_logs_port_range CHECK (port >= 0 AND port <= 65535);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xray_logs_uniqueness') THEN
    ALTER TABLE xray_logs
      ADD CONSTRAINT xray_logs_uniqueness
      UNIQUE (datetime, xray_user, user_ip, target, port, protocol_in, protocol_out, node_ip, node_name, inbound, outbound);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_xray_logs_datetime ON xray_logs (datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_user     ON xray_logs (xray_user, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_user_ip  ON xray_logs (user_ip, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_target   ON xray_logs (target, datetime DESC);
CREATE INDEX IF NOT EXISTS idx_xray_logs_node     ON xray_logs (node_name, datetime DESC);
`;

async function ensureSchema(pool, attempts = 30) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      await pool.query(MIGRATION_SQL);
      console.log('DB schema ensured.');
      return;
    } catch (e) {
      lastErr = e;
      console.log(`DB not ready (try ${i}/${attempts}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}
/** ------------------------------------------------------------------------- */

const DENY_TARGETS = new Set((process.env.DENY_TARGETS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const DENY_PORTS = new Set((process.env.DENY_PORTS || '').split(',').map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n)));

const app = express();
app.use(helmet());
app.use(express.json({ limit: process.env.BODY_LIMIT || '25mb' }));
app.use(morgan('combined'));

const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
if (TRUST_PROXY) app.set('trust proxy', true);

function extractNodeIp(req) {
  // если включен trust proxy — Express возьмёт левый X-Forwarded-For
  let ip = TRUST_PROXY
    ? req.ip
    : (req.socket?.remoteAddress || '');

  if (ip && ip.startsWith('::ffff:')) ip = ip.slice(7);

  return ip || '0.0.0.0';
}
/** ------------------------------------------------------------ */

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const recordSchema = z.object({
  datetime_iso: z.string(),
  xray_user: z.string(),
  user_ip: z.string(),
  target: z.string(),
  port: z.number().int().min(0).max(65535),
  protocol_in: z.string().optional().nullable(),
  protocol_out: z.enum(['tcp', 'udp']),
  inbound: z.string(),
  outbound: z.string(),
  node_name: z.string(),
});
const payloadSchema = z.object({
  node_name: z.string(),
  sent_at: z.string(),
  records: z.array(recordSchema),
});

function decryptPayload({ iv_b64, tag_b64, data_b64 }) {
  const iv = Buffer.from(iv_b64, 'base64');
  const authTag = Buffer.from(tag_b64, 'base64');
  const ciphertext = Buffer.from(data_b64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

app.post('/api/v1/logs', async (req, res) => {
  try {
    const { iv_b64, tag_b64, data_b64 } = req.body || {};
    if (!iv_b64 || !tag_b64 || !data_b64) return res.status(400).json({ error: 'Missing iv_b64/tag_b64/data_b64' });

    let decrypted;
    try { decrypted = decryptPayload({ iv_b64, tag_b64, data_b64 }); }
    catch (e) { console.error('Decryption error:', e.message); return res.status(400).json({ error: 'Bad ciphertext' }); }

    const parsed = payloadSchema.safeParse(decrypted);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

    const allowedNodeNames = (process.env.ALLOWED_NODE_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowedNodeNames.length && !allowedNodeNames.includes(parsed.data.node_name)) {
      return res.status(403).json({ error: 'Node not allowed' });
    }

    const nodeIp = extractNodeIp(req);

    const originalCount = parsed.data.records.length;
    let records = parsed.data.records;
    if (DENY_TARGETS.size || DENY_PORTS.size) {
      records = records.filter(r =>
        !DENY_TARGETS.has(String(r.target || '').toLowerCase()) &&
        !DENY_PORTS.has(Number(r.port))
      );
    }

    const client = await pool.connect();
    try {
      if (!records.length) return res.json({ received: originalCount, filtered: originalCount, inserted: 0 });

      const cols = ['xray_user','user_ip','target','port','protocol_in','protocol_out','node_ip','node_name','inbound','outbound','datetime'];
      const values = [];
      const placeholders = [];
      records.forEach((r, idx) => {
        const baseIndex = idx * cols.length;
        placeholders.push(`(${cols.map((_, i) => '$' + (baseIndex + i + 1)).join(',')})`);
        values.push(
          r.xray_user, r.user_ip, r.target, r.port,
          r.protocol_in ?? null, r.protocol_out,
          nodeIp,
          r.node_name, r.inbound, r.outbound,
          new Date(r.datetime_iso),
        );
      });

      const sql = `INSERT INTO xray_logs (${cols.join(',')}) VALUES ${placeholders.join(',')}
                   ON CONFLICT ON CONSTRAINT xray_logs_uniqueness DO NOTHING`;
      const result = await client.query(sql, values);
      res.json({ received: originalCount, filtered: originalCount - records.length, inserted: result.rowCount });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

(async () => {
  try {
    await ensureSchema(pool);
    app.listen(PORT, () => { console.log(`xray-logger server listening on :${PORT}`); });
  } catch (e) {
    console.error('Failed to ensure DB schema:', e);
    process.exit(1);
  }
})();
