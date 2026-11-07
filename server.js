import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const API_BASE = 'https://1click.chaindefuser.com/v0';
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT']);
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
  // The minimum is enforced after the 1Click quote using its authoritative amountInUsd field.
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
    const inputUsd = Number(data?.quote?.amountInUsd);
    if (!Number.isFinite(inputUsd) || inputUsd < 0.01) {
      return res.status(400).json({ error: Number.isFinite(inputUsd)
        ? 'Minimum swap amount is $0.01 USD equivalent.'
        : '1Click did not return a valid USD input estimate, so the $0.01 minimum cannot be verified. Please try again.' });
    }
    if (!data?.quote?.depositAddress || !data?.quote?.amountIn) {
      return res.status(502).json({ error: '1Click returned an incomplete committed quote. No payment should be sent.' });
    }
    res.json({ ...data, intentpay: { origin: input.origin, destination: input.destination } });
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
    res.json({ ...data, terminal: TERMINAL.has(data.status) });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`IntentPay API listening on :${PORT}`));

export default app;
