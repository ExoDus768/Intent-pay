import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const API_BASE = 'https://1click.chaindefuser.com/v0';
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT']);
const INVOICE_TTL = 60 * 60 * 24 * 180;

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const error = new Error('Merchant links, dashboard sync, and webhooks need UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Persistent storage request failed.');
  return data.result;
}

function publicInvoice(invoice) {
  const { webhookSecret, ...safe } = invoice;
  return { ...safe, webhookConfigured: Boolean(invoice.webhookUrl), webhookDelivered: Boolean(invoice.webhookDeliveredAt) };
}

function isPrivateIp(address) {
  if (address.includes(':')) {
    const value = address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  const parts = address.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 ||
    parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

async function validateWebhookUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Webhook URL is invalid.'), { status: 400 }); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local') || isIP(url.hostname)) {
    throw Object.assign(new Error('Webhook must use a public HTTPS hostname.'), { status: 400 });
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
    throw Object.assign(new Error('Webhook host must resolve only to public IP addresses.'), { status: 400 });
  }
  return url.toString();
}

async function readInvoice(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{24,64}$/i.test(id)) return null;
  const raw = await redisCommand(['GET', `intentpay:invoice:${id}`]);
  return raw ? JSON.parse(raw) : null;
}

async function writeInvoice(invoice) {
  await redisCommand(['SET', `intentpay:invoice:${invoice.id}`, JSON.stringify(invoice), 'EX', INVOICE_TTL]);
}

async function deliverInvoiceWebhook(invoice) {
  if (!invoice.webhookUrl || invoice.webhookDeliveredAt) return;
  const lock = await redisCommand(['SET', `intentpay:webhook-lock:${invoice.id}`, '1', 'NX', 'EX', '60']);
  if (lock !== 'OK') return;
  const payload = {
    id: `evt_${invoice.id}`, type: 'payment.succeeded', createdAt: new Date().toISOString(),
    data: { invoiceId: invoice.id, status: 'SUCCESS', amount: invoice.amount, symbol: invoice.symbol,
      destinationAsset: invoice.destinationAsset, recipient: invoice.recipient, depositAddress: invoice.depositAddress }
  };
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', invoice.webhookSecret).update(body).digest('hex');
  try {
    const response = await fetch(invoice.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-IntentPay-Event': payload.type, 'X-IntentPay-Signature': `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
    invoice.webhookDeliveredAt = new Date().toISOString();
    invoice.webhookLastError = '';
    await writeInvoice(invoice);
  } catch (error) {
    invoice.webhookLastError = error.message;
    await writeInvoice(invoice);
    await redisCommand(['DEL', `intentpay:webhook-lock:${invoice.id}`]);
  }
}

app.disable('x-powered-by');
app.use(cors({ origin: process.env.APP_ORIGIN ? process.env.APP_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '32kb' }));

let tokenCache = { value: null, expiresAt: 0 };

function authHeaders() {
  if (!process.env.ONECLICK_JWT) {
    const error = new Error('The server is missing ONECLICK_JWT. Add your 1Click key to the server environment.');
    error.status = 503;
    throw error;
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ONECLICK_JWT}` };
}

async function oneClick(path, options = {}, authenticated = true) {
  const headers = { 'Content-Type': 'application/json', ...(authenticated ? authHeaders() : {}), ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `1Click API returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getTokens() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const data = await oneClick('/tokens', { method: 'GET' }, false);
  const list = Array.isArray(data) ? data : (data.tokens || data.data || []);
  if (!Array.isArray(list)) throw new Error('Unexpected token registry response.');
  tokenCache = { value: list, expiresAt: Date.now() + 5 * 60 * 1000 };
  return list;
}

function isEvmAddress(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isNearAccount(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 &&
    /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(value) && !value.startsWith('.') && !value.endsWith('.');
}

function getToken(tokens, assetId) {
  return tokens.find(token => token.assetId === assetId);
}

function validateQuoteBody(body, tokens) {
  const { originAsset, destinationAsset, amount, recipient, refundTo, nearSenderAccount, swapType = 'EXACT_INPUT', slippageTolerance = 100 } = body || {};
  if (!originAsset || !destinationAsset || !amount || !recipient || !refundTo) {
    const error = new Error('originAsset, destinationAsset, amount, recipient, and refundTo are required.');
    error.status = 400;
    throw error;
  }
  if (!/^\d+$/.test(String(amount)) || BigInt(amount) <= 0n) {
    const error = new Error('amount must be a positive integer in the token smallest unit.');
    error.status = 400;
    throw error;
  }
  if (!['EXACT_INPUT', 'EXACT_OUTPUT'].includes(swapType)) {
    const error = new Error('Only EXACT_INPUT and EXACT_OUTPUT quotes are enabled.');
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(slippageTolerance) || slippageTolerance < 1 || slippageTolerance > 3000) {
    const error = new Error('slippageTolerance must be an integer from 1 to 3000 basis points.');
    error.status = 400;
    throw error;
  }
  const origin = getToken(tokens, originAsset);
  const destination = getToken(tokens, destinationAsset);
  if (!origin || !destination) {
    const error = new Error('One of the selected assets is not present in the live 1Click token registry.');
    error.status = 400;
    throw error;
  }
  const isNearOrigin = String(origin.blockchain || '').toLowerCase() === 'near';
  if (isNearOrigin ? (!isNearAccount(refundTo) || refundTo !== nearSenderAccount) : !isEvmAddress(refundTo)) {
    const error = new Error(isNearOrigin
      ? 'For a NEAR-origin payment, refundTo and nearSenderAccount must be the connected NEAR account.'
      : 'For an EVM-origin payment, refundTo must be the connected EVM wallet address.');
    error.status = 400;
    throw error;
  }
  if (typeof recipient !== 'string' || recipient.trim().length < 2 || recipient.length > 128) {
    const error = new Error('The merchant payout address is invalid.');
    error.status = 400;
    throw error;
  }
  return { origin, destination, amount: String(amount), recipient: recipient.trim(), refundTo, nearSenderAccount, isNearOrigin, slippageTolerance, swapType };
}


app.post('/api/invoices', async (req, res) => {
  try {
    const { destinationAsset, amount, recipient, description = '', webhookUrl = '' } = req.body || {};
    const tokens = await getTokens();
    const destination = getToken(tokens, destinationAsset);
    if (!destination) return res.status(400).json({ error: 'Choose a payout asset from the live NEAR Intents registry.' });
    if (typeof amount !== 'string' || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Invoice amount must be a positive decimal string.' });
    }
    const decimals = Number(destination.decimals);
    const fraction = amount.split('.')[1] || '';
    if (fraction.length > decimals) return res.status(400).json({ error: `This token supports at most ${decimals} decimal places.` });
    const isNearDestination = String(destination.blockchain || '').toLowerCase() === 'near';
    if (isNearDestination ? !isNearAccount(recipient) : !isEvmAddress(recipient)) {
      return res.status(400).json({ error: isNearDestination ? 'Enter a valid NEAR payout account.' : 'Enter a valid EVM payout address.' });
    }
    const safeWebhook = await validateWebhookUrl(webhookUrl);
    const id = randomBytes(18).toString('hex');
    const invoice = {
      id, destinationAsset, destinationChain: destination.blockchain, symbol: destination.symbol,
      decimals, amount, recipient: recipient.trim(), description: String(description).slice(0, 140),
      webhookUrl: safeWebhook, webhookSecret: safeWebhook ? randomBytes(32).toString('hex') : '',
      createdAt: new Date().toISOString(), status: 'CREATED'
    };
    await writeInvoice(invoice);
    res.status(201).json({ invoice: publicInvoice(invoice), webhookSecret: invoice.webhookSecret || undefined });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await readInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found or expired.' });
    res.json(publicInvoice(invoice));
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.post('/api/invoices/:id/webhook/retry', async (req, res) => {
  try {
    const invoice = await readInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found or expired.' });
    if (invoice.status !== 'SUCCESS') return res.status(409).json({ error: 'Webhook retry is available only after confirmed payment success.' });
    if (!invoice.webhookUrl) return res.status(400).json({ error: 'No webhook is configured for this invoice.' });
    invoice.webhookDeliveredAt = '';
    await writeInvoice(invoice);
    await deliverInvoiceWebhook(invoice);
    const updated = await readInvoice(invoice.id);
    res.json(publicInvoice(updated));
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'intentpay-api' }));

app.get('/api/config', (_req, res) => res.json({
  oneClickConfigured: Boolean(process.env.ONECLICK_JWT),
  provider: '1Click mainnet', network: 'mainnet'
}));

app.get('/api/tokens', async (_req, res) => {
  try { res.json(await getTokens()); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.post('/api/quote', async (req, res) => {
  try {
    const tokens = await getTokens();
    const input = validateQuoteBody(req.body, tokens);
    let invoice = null;
    if (req.body?.invoiceId) {
      invoice = await readInvoice(req.body.invoiceId);
      if (!invoice) return res.status(404).json({ error: 'This payment link is invalid or expired.' });
      if (input.swapType !== 'EXACT_OUTPUT' || input.destination.assetId !== invoice.destinationAsset ||
          input.recipient.toLowerCase() !== invoice.recipient.toLowerCase()) {
        return res.status(400).json({ error: 'The quote does not match the merchant invoice.' });
      }
      const expectedAtomic = invoice.amount.replace('.', '').padEnd(invoice.amount.includes('.') ? invoice.amount.split('.')[0].length + invoice.decimals : invoice.amount.length + invoice.decimals, '0');
      if (BigInt(input.amount) !== BigInt(expectedAtomic)) return res.status(400).json({ error: 'The requested output amount does not match the fixed invoice amount.' });
    }
    const request = {
      dry: false,
      swapType: input.swapType,
      originAsset: input.origin.assetId,
      destinationAsset: input.destination.assetId,
      amount: input.amount,
      recipient: input.recipient,
      refundTo: input.refundTo,
      depositType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      slippageTolerance: input.slippageTolerance,
      deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      referral: 'intentpay'
    };
    const data = await oneClick('/quote', { method: 'POST', body: JSON.stringify(request) });
    if (!data?.quote?.depositAddress || !data?.quote?.amountIn) {
      return res.status(502).json({ error: '1Click returned an incomplete committed quote. No payment should be sent.' });
    }
    if (invoice) {
      invoice.depositAddress = data.quote.depositAddress;
      invoice.status = 'PENDING_DEPOSIT';
      invoice.correlationId = data.correlationId || '';
      await writeInvoice(invoice);
      await redisCommand(['SET', `intentpay:deposit:${data.quote.depositAddress}`, invoice.id, 'EX', INVOICE_TTL]);
    }
    res.json({ ...data, intentpay: { origin: input.origin, destination: input.destination, invoiceId: invoice?.id || null } });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post('/api/deposit/submit', async (req, res) => {
  const { txHash, depositAddress, depositMemo, nearSenderAccount } = req.body || {};
  if (typeof txHash !== 'string' || txHash.length < 10 || txHash.length > 160 ||
      typeof depositAddress !== 'string' || depositAddress.length < 5 || depositAddress.length > 160) {
    return res.status(400).json({ error: 'A valid txHash and depositAddress are required.' });
  }
  try {
    const payload = { txHash, depositAddress };
    if (nearSenderAccount) {
      if (!isNearAccount(nearSenderAccount)) return res.status(400).json({ error: 'nearSenderAccount is not a valid NEAR account ID.' });
      payload.nearSenderAccount = nearSenderAccount;
    }
    if (depositMemo) payload.memo = String(depositMemo);
    const data = await oneClick('/deposit/submit', { method: 'POST', body: JSON.stringify(payload) });
    res.json(data);
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.get('/api/status', async (req, res) => {
  const { depositAddress, depositMemo } = req.query;
  if (typeof depositAddress !== 'string' || depositAddress.length < 5 || depositAddress.length > 160) {
    return res.status(400).json({ error: 'depositAddress is required.' });
  }
  try {
    const query = new URLSearchParams({ depositAddress });
    if (typeof depositMemo === 'string' && depositMemo) query.set('depositMemo', depositMemo);
    const data = await oneClick(`/status?${query.toString()}`, { method: 'GET' });
    const invoiceId = await redisCommand(['GET', `intentpay:deposit:${depositAddress}`]);
    if (invoiceId) {
      const invoice = await readInvoice(invoiceId);
      if (invoice) {
        invoice.status = data.status || invoice.status;
        invoice.lastCheckedAt = new Date().toISOString();
        await writeInvoice(invoice);
        if (data.status === 'SUCCESS') await deliverInvoiceWebhook(invoice);
      }
    }
    res.json({ ...data, terminal: TERMINAL.has(data.status), invoiceId: invoiceId || null });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`IntentPay API listening on :${PORT}`));

export default app;
