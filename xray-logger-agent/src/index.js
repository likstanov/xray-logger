import fs from 'fs';
import http from 'http';
import https from 'https';
import axios from 'axios';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';
import { encrypt } from './libcrypto.js';
import { parseLine } from './parser.js';

dotenv.config();

const ACCESS_LOG_PATH = process.env.ACCESS_LOG_PATH || '/var/lib/marzban-node/access.log';
const API_URL = (process.env.API_URL || '').replace(/\/+$/, '') + '/api/v1/logs';
const NODE_NAME = process.env.NODE_NAME || 'UNKNOWN';
const LOG_TZ = process.env.LOG_TIMEZONE || 'UTC';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 200);
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 2000);
const START_FROM_BEGINNING = (process.env.START_FROM_BEGINNING || 'false').toLowerCase() === 'true';
const ENCRYPTION_KEY_BASE64 = process.env.ENCRYPTION_KEY_BASE64;
const VERIFY_TLS = (process.env.VERIFY_TLS || 'true').toLowerCase() === 'true';

const DENY_TARGETS = (process.env.DENY_TARGETS || 'one.one.one.one,dns.google,1.1.1.1')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const DENY_PORTS = (process.env.DENY_PORTS || '53,853')
  .split(',').map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n));

const TRUNCATE_ENABLED = (process.env.TRUNCATE_ENABLED || 'false').toLowerCase() === 'true';
const TRUNCATE_INTERVAL_STR = (process.env.TRUNCATE_INTERVAL || '24h').trim();

if (!API_URL) { console.error('API_URL is required'); process.exit(1); }
if (!ENCRYPTION_KEY_BASE64) { console.error('ENCRYPTION_KEY_BASE64 is required'); process.exit(1); }

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: VERIFY_TLS });

let buffer = [];
let timer = null;
let flushing = false;

// текущая позиция чтения
let lastSize = 0;
let position = 0;

function parseIntervalToMs(s) {
  const m = String(s).trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!m) return 24 * 60 * 60 * 1000; // сутки по умолчанию
  const n = Number(m[1]);
  const unit = (m[2] || 'ms').toLowerCase();
  switch (unit) {
    case 'ms': return n;
    case 's':  return n * 1000;
    case 'm':  return n * 60 * 1000;
    case 'h':  return n * 60 * 60 * 1000;
    case 'd':  return n * 24 * 60 * 60 * 1000;
    default:   return 24 * 60 * 60 * 1000;
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush().catch(e => console.error('flush error', e.message)); }, FLUSH_INTERVAL_MS);
}

function shouldDropByPolicy(target, port) {
  const t = String(target || '').toLowerCase();
  const p = Number(port);
  return DENY_TARGETS.includes(t) || DENY_PORTS.includes(p);
}

async function sendBatch(batch) {
  const payload = {
    node_name: NODE_NAME,
    sent_at: new Date().toISOString(),
    records: batch,
  };
  const { iv_b64, tag_b64, data_b64 } = encrypt(payload, ENCRYPTION_KEY_BASE64);
  const res = await axios.post(
    API_URL,
    { iv_b64, tag_b64, data_b64 },
    { httpAgent, httpsAgent, timeout: 10000, maxBodyLength: 10 * 1024 * 1024 }
  );
  const { received, inserted } = res.data || {};
  console.log(`sent=${batch.length} received=${received} inserted=${inserted}`);
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, Math.min(buffer.length, BATCH_SIZE));
      try {
        await sendBatch(batch);
      } catch (e) {
        const status = e.response?.status;
        const data = e.response?.data;
        console.error('send failed:', status, data || e.message);
        buffer = batch.concat(buffer);
        break;
      }
      if (buffer.length === 0) break;
    }
  } finally {
    flushing = false;
  }
}

function toUTC(dateStr, timeStr) {
  const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy/MM/dd HH:mm:ss', { zone: LOG_TZ });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

function handleLine(line) {
  if (!line) return;
  if (line.includes(' DOH//') || line.includes(' got answer:')) return;

  const parsed = parseLine(line);
  if (!parsed) return;

  const dtIso = toUTC(parsed.date, parsed.time);
  if (!dtIso) return;

  if (shouldDropByPolicy(parsed.target, parsed.port)) return;

  buffer.push({
    datetime_iso: dtIso,
    xray_user: parsed.xray_user_after_dot,
    user_ip: parsed.user_ip,
    target: parsed.target,
    port: parsed.port,
    protocol_in: parsed.protocol_in || null,
    protocol_out: parsed.protocol_out,
    inbound: parsed.inbound,
    outbound: parsed.outbound,
    node_name: NODE_NAME,
  });

  if (buffer.length >= BATCH_SIZE) {
    flush().catch(e => console.error('flush error', e.message));
  } else {
    scheduleFlush();
  }
}

async function poll() {
  try {
    const stats = await fs.promises.stat(ACCESS_LOG_PATH);

    if (stats.size < lastSize) {
      position = 0;
    }
    lastSize = stats.size;

    if (position < stats.size) {
      const readStream = fs.createReadStream(ACCESS_LOG_PATH, { start: position, end: stats.size - 1, encoding: 'utf8' });
      let leftover = '';
      for await (const chunk of readStream) {
        const data = leftover + chunk;
        const lines = data.split(/\r?\n/);
        leftover = lines.pop() || '';
        for (const line of lines) handleLine(line);
      }
      position = stats.size;
    }
  } catch (e) {
    console.error('poll error:', e.message);
  } finally {
    setTimeout(poll, 1000);
  }
}

function startTruncateScheduler() {
  if (!TRUNCATE_ENABLED) return;
  const intervalMs = parseIntervalToMs(TRUNCATE_INTERVAL_STR);
  const used = (Number.isFinite(intervalMs) && intervalMs >= 10_000) ? intervalMs : 24 * 60 * 60 * 1000;
  if (used !== intervalMs) console.warn(`TRUNCATE_INTERVAL="${TRUNCATE_INTERVAL_STR}" некорректен/слишком мал; используем 24h`);
  console.log(`truncate scheduler enabled: every ${used} ms`);
  setInterval(doTruncate, used);
}

async function doTruncate() {
  try {
    await flush().catch(() => {});
    await fs.promises.truncate(ACCESS_LOG_PATH, 0);
    lastSize = 0;
    position = 0;
    console.log(`log truncated: ${ACCESS_LOG_PATH}`);
  } catch (e) {
    console.warn(`truncate failed: ${e.message} (make sure that volume is not :ro and that you have rights to the file.)`);
  }
}

(async function main() {
  try {
    const stats = await fs.promises.stat(ACCESS_LOG_PATH);
    lastSize = stats.size;
    position = START_FROM_BEGINNING ? 0 : stats.size;
  } catch {
    console.warn(`Waiting for log file at ${ACCESS_LOG_PATH} ...`);
  } finally {
    poll();
    startTruncateScheduler();
    console.log('xray-logger-agent started');
  }
})();

process.on('SIGTERM', async () => { console.log('SIGTERM, flushing...'); await flush(); process.exit(0); });
process.on('SIGINT',  async () => { console.log('SIGINT,  flushing...'); await flush(); process.exit(0); });
