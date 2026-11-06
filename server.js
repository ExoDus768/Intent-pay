import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const API_BASE = 'https://1click.chaindefuser.com/v0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.ONECLICK_JWT) h.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;
  return h;
}

async function proxy(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `1Click API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'intentpay-api' }));

app.get('/api/config', (_req, res) => res.json({
  oneClickConfigured: Boolean(process.env.ONECLICK_JWT),
  mode: process.env.ONECLICK_MODE || 'mainnet'
}));

app.get('/api/tokens', async (_req, res) => {
  try {
    const response = await fetch(`${API_BASE}/tokens`);
    if (!response.ok) throw new Error(`Token registry returned ${response.status}`);
    res.json(await response.json());
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/quote', async (req, res) => {
  if (!process.env.ONECLICK_JWT) return res.status(503).json({ error: 'Server is missing ONECLICK_JWT. Add it as a server-side environment variable.' });
  try {
    const data = await proxy('/quote', { method: 'POST', body: JSON.stringify(req.body) });
    res.json(data);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post('/api/deposit/submit', async (req, res) => {
  if (!process.env.ONECLICK_JWT) return res.status(503).json({ error: 'Server is missing ONECLICK_JWT.' });
  try {
    const data = await proxy('/deposit/submit', { method: 'POST', body: JSON.stringify(req.body) });
    res.json(data);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get('/api/status', async (req, res) => {
  if (!process.env.ONECLICK_JWT) return res.status(503).json({ error: 'Server is missing ONECLICK_JWT.' });
  try {
    const data = await proxy(`/status?${new URLSearchParams(req.query)}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`IntentPay API listening on :${PORT}`));
