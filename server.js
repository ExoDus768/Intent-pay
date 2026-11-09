import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createHash, createHmac, randomBytes, timingSafeEqual, createPublicKey, verify as verifySignature } from 'node:crypto';
import { verifyMessage, JsonRpcProvider, Interface, isAddress } from 'ethers';
import { del as delBlob, get as getBlob, list as listBlobs, put as putBlob } from '@vercel/blob';
import { rateLimit } from 'express-rate-limit';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const API_BASE = 'https://1click.chaindefuser.com/v0';
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT']);
app.disable('x-powered-by');
// Vercel is the single trusted reverse-proxy hop for client IP rate limiting.
app.set('trust proxy', 1);
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const allowedOrigins = new Set((process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    if (allowedOrigins.has(origin)) return callback(null, true);
    if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: '32kb' }));

// MemoryStore is a per-instance safety net. For globally consistent limits across
// Vercel instances, replace it with a shared Redis/Upstash store.
const makeLimiter = (windowMs, limit, message) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: message }, validate: { trustProxy: false }
});
const apiLimiter = makeLimiter(60 * 1000, 180, 'Too many API requests. Please slow down.');
app.use('/api', apiLimiter);
const quoteLimiter = makeLimiter(60 * 1000, 12, 'Too many quote requests. Please wait before requesting another quote.');
const historyChallengeLimiter = makeLimiter(10 * 60 * 1000, 5, 'Too many wallet sign-in challenges. Please try again later.');
const historyVerifyLimiter = makeLimiter(10 * 60 * 1000, 10, 'Too many wallet signature attempts. Please try again later.');
const paymentActionLimiter = makeLimiter(60 * 1000, 20, 'Too many payment verification requests. Please wait.');

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
    console.error('[1Click] upstream request failed', {
      path,
      upstreamStatus: response.status,
      providerMessage: String(data.message || data.error || 'No provider message').slice(0, 500)
    });
    const firstError = Array.isArray(data.errors) ? data.errors[0] : null;
    const providerMessage = String(
      data.message || data.error?.message || data.error || firstError?.message ||
      firstError?.detail || 'No provider message'
    ).slice(0, 500);
    const minimumMatch = providerMessage.match(/minimum(?:\s+swap)?\s+amount(?:\s+(?:is|of)|\s*:)?\s*\$?([\d,.]+)/i);
    const userMessage = minimumMatch
      ? `NEAR Intents currently reports a route minimum of ${minimumMatch[1]}. No deposit address was created. Try another API-supported route or amount if you choose.`
      : `NEAR Intents rejected this quote (HTTP ${response.status}). No deposit address was created. ${providerMessage}`;
    const error = new Error(userMessage);
    error.status = 502;
    error.upstreamStatus = response.status;
    error.providerMessage = providerMessage;
    error.retryable = [429, 502, 503, 504].includes(response.status);
    const retryAfter = Number(response.headers.get('retry-after'));
    error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 900;
    throw error;
  }
  return data;
}

const normalizeBlockchain = (value, assetId = '') => {
  const raw = String(value || '').trim().toLowerCase().replace(/[_ ]+/g, '-');
  const aliases = {
    'ethereum':'eth','ethereum-mainnet':'eth','arbitrum-one':'arbitrum','arb':'arbitrum',
    'binance-smart-chain':'bsc','bnb':'bsc','bnb-chain':'bsc','binance':'bsc',
    'avalanche-c-chain':'avalanche','avax':'avalanche','op':'optimism',
    'matic':'polygon','pol':'polygon','ftm':'fantom','bera':'berachain',
    'sol':'solana','xdai':'gnosis'
  };
  if (raw) return aliases[raw] || raw;
  const id = String(assetId || '');
  const nep = id.match(/^nep141:([a-z0-9]+)-/i)?.[1]?.toLowerCase();
  if (nep) return aliases[nep] || nep;
  const oneCs = id.match(/^1cs_v1:([^:]+):/i)?.[1]?.toLowerCase();
  if (oneCs) return aliases[oneCs] || oneCs;
  return null;
}

async function getTokens() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const data = await oneClick('/tokens', { method: 'GET' }, false);
  let list = data;
  for (let depth = 0; depth < 4 && !Array.isArray(list); depth++) {
    list = list?.tokens || list?.data || list?.result || list?.assets;
  }
  if (!Array.isArray(list)) throw new Error('Unexpected token registry response.');
  list = list.filter(token => token && typeof token.assetId === 'string' &&
    Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255)
    .map(token => {
      const blockchain = normalizeBlockchain(token.blockchain, token.assetId);
      return { ...token, blockchain, decimals: Number(token.decimals) };
    }).filter(token => token.blockchain);
  if (!list.length) throw new Error('The live NEAR Intents token registry returned no usable assets.');
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

function formatAtomicAmount(value, decimals) {
  const raw = String(value);
  const precision = Number(decimals);
  if (!/^\d+$/.test(raw) || !Number.isInteger(precision) || precision < 0 || precision > 255) return null;
  if (precision === 0) return raw;
  const padded = raw.padStart(precision + 1, '0');
  const whole = padded.slice(0, -precision);
  const fraction = padded.slice(-precision).replace(/0+$/, '');
  return fraction ? whole + '.' + fraction : whole;
}

const EVM_BLOCKCHAINS = new Set([
  'eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism',
  'polygon', 'bsc', 'bnb', 'avax', 'avalanche', 'gnosis', 'scroll',
  'aurora', 'bera', 'berachain', 'fantom', 'ftm', 'linea', 'zksync',
  'mantle', 'mode', 'blast', 'celo', 'worldchain'
]);
function isValidDestinationRecipient(recipient, blockchain) {
  const chain = String(blockchain || '').trim().toLowerCase();
  if (chain === 'near') return isNearAccount(recipient);
  if (EVM_BLOCKCHAINS.has(chain)) return isAddress(recipient);
  if (['sol', 'solana'].includes(chain)) {
    try { return decodeBase58(recipient).length === 32; } catch { return false; }
  }
  // Fail closed for chains without an implemented address/checksum validator.
  return false;
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
  const originChain = String(origin.blockchain || '').toLowerCase();
  const isNearOrigin = originChain === 'near';
  const isSolanaOrigin = ['solana', 'sol'].includes(originChain);
  const validRefundAddress = isNearOrigin
    ? (isNearAccount(refundTo) && refundTo === nearSenderAccount)
    : isSolanaOrigin
      ? (() => { try { return decodeBase58(refundTo).length === 32; } catch { return false; } })()
      : isEvmAddress(refundTo);
  if (!validRefundAddress) {
    const error = new Error(isNearOrigin
      ? 'For a NEAR-origin payment, refundTo and nearSenderAccount must be the connected NEAR account.'
      : isSolanaOrigin
        ? 'For a Solana-origin payment, refundTo must be the connected Solana wallet address.'
        : 'For an EVM-origin payment, refundTo must be the connected EVM wallet address.');
    error.status = 400;
    throw error;
  }
  const normalizedRecipient = typeof recipient === 'string' ? recipient.trim() : '';
  if (!normalizedRecipient || normalizedRecipient.length > 128 ||
      !isValidDestinationRecipient(normalizedRecipient, destination.blockchain)) {
    const error = new Error(`The merchant payout address is not valid for the destination network (${destination.blockchain || 'unknown'}).`);
    error.status = 400;
    throw error;
  }
  return { origin, destination, amount: String(amount), recipient: normalizedRecipient, refundTo, nearSenderAccount, isNearOrigin, slippageTolerance, swapType };
}



function historySecret() {
  const secret = process.env.XODUSPAY_HISTORY_SECRET || undefined;
  if (!secret) {
    const error = new Error('Wallet history authentication is not configured.');
    error.status = 503;
    throw error;
  }
  if (secret.length < 32) {
    const error = new Error('XODUSPAY_HISTORY_SECRET must contain at least 32 characters.');
    error.status = 503;
    throw error;
  }
  return secret;
}
function signHistoryPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', historySecret()).update(body).digest('base64url');
  return body + '.' + signature;
}
function readHistoryPayload(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', historySecret()).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
const locallyConsumedChallenges = new Set();
let challengeCleanupCounter = 0;
async function cleanupConsumedChallenges() {
  try {
    const page = await listBlobs({ prefix: 'xoduspay-auth-consumed/', limit: 1000 });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const stale = page.blobs.filter(blob => new Date(blob.uploadedAt).getTime() < cutoff);
    if (stale.length) await delBlob(stale.map(blob => blob.pathname), { access: 'private' });
  } catch { /* Cleanup is best-effort; replay protection itself remains fail-closed. */ }
}
async function consumeChallengeNonce(nonce) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (isProduction) {
      const error = new Error('Persistent challenge replay protection is not configured. Set BLOB_READ_WRITE_TOKEN.');
      error.status = 503;
      throw error;
    }
    if (locallyConsumedChallenges.has(nonce)) return false;
    locallyConsumedChallenges.add(nonce);
    return true;
  }
  const pathname = 'xoduspay-auth-consumed/' + createHash('sha256').update(nonce).digest('hex') + '.json';
  try {
    await putBlob(pathname, JSON.stringify({ consumedAt: Date.now() }), {
      access: 'private', contentType: 'application/json', allowOverwrite: false, addRandomSuffix: false
    });
    challengeCleanupCounter++;
    if (challengeCleanupCounter % 50 === 0) void cleanupConsumedChallenges();
    return true;
  } catch (error) {
    if (isBlobWriteConflict(error)) return false;
    throw error;
  }
}
function requireHistorySession(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
  const payload = readHistoryPayload(bearer);
  if (!payload || payload.type !== 'session' || !payload.wallet || !payload.exp || payload.exp < Date.now()) {
    const error = new Error('Wallet session expired. Sign the wallet message again.');
    error.status = 401;
    throw error;
  }
  return payload;
}
function historyWalletKey(wallet) {
  return createHash('sha256').update(String(wallet).trim().toLowerCase()).digest('hex');
}
function borshString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function decodeBase58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Invalid base58 public key.');
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const zeros = value.match(/^1*/)?.[0].length || 0;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}
async function verifyNearHistorySignature({ wallet, message, nonce, signature, publicKey, recipient }) {
  if (!/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(wallet) || !publicKey || !signature || !publicKey.startsWith('ed25519:')) return false;
  const nonceBytes = Buffer.from(nonce, 'hex');
  if (nonceBytes.length !== 32) return false;
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2147484061);
  const nep413Payload = Buffer.concat([tag, borshString(message), nonceBytes, borshString(recipient), Buffer.from([0])]);
  const digest = createHash('sha256').update(nep413Payload).digest();
  let valid = false;
  try {
    const rawKey = decodeBase58(publicKey.slice('ed25519:'.length));
    if (rawKey.length !== 32) return false;
    const derKey = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]);
    const keyObject = createPublicKey({ key: derKey, format: 'der', type: 'spki' });
    valid = verifySignature(null, digest, keyObject, Buffer.from(signature, 'base64'));
  } catch { return false; }
  if (!valid) return false;
  const rpc = await fetch('https://rpc.mainnet.near.org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'xoduspay-history-auth', method: 'query', params: { request_type: 'view_access_key_list', finality: 'final', account_id: wallet } })
  });
  const data = await rpc.json();
  if (!rpc.ok || data.error) return false;
  return (data.result?.keys || []).some(item =>
    item.public_key === publicKey && item.access_key?.permission === 'FullAccess'
  );
}
function normalizeHistoryDate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  let date;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) date = null;
    else date = new Date(value);
  } else if (typeof value === 'string' && !/^[-+]?\d+$/.test(value.trim())) {
    date = new Date(value);
  } else {
    date = null;
  }
  if (!date || !Number.isFinite(date.getTime())) {
    const error = new Error('Transaction history contains an invalid createdAt or updatedAt timestamp.');
    error.status = 400;
    throw error;
  }
  return date.toISOString();
}
function historyTimestamp(row) {
  const value = row.updatedAt || row.createdAt;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
function cleanHistoryEntries(entries) {
  if (!Array.isArray(entries)) {
    const error = new Error('Transaction history must be an array.');
    error.status = 400;
    throw error;
  }
  return entries.slice(0, 100).filter(item => item && typeof item.id === 'string' && item.id.length <= 180).map(item => ({
    id: item.id,
    merchant: String(item.merchant || 'Merchant payment').slice(0, 100),
    purpose: String(item.purpose || '').slice(0, 160),
    sourceNetwork: String(item.sourceNetwork || '').slice(0, 60),
    sourceToken: String(item.sourceToken || '').slice(0, 30),
    destinationNetwork: String(item.destinationNetwork || '').slice(0, 60),
    destinationToken: String(item.destinationToken || '').slice(0, 30),
    amountPaid: String(item.amountPaid || '').slice(0, 80),
    amountReceived: String(item.amountReceived || '').slice(0, 80),
    transactionHash: String(item.transactionHash || '').slice(0, 180),
    depositAddress: String(item.depositAddress || '').slice(0, 180),
    status: String(item.status || 'PROCESSING').slice(0, 40),
    fixedAmount: Boolean(item.fixedAmount),
    createdAt: normalizeHistoryDate(item.createdAt, new Date().toISOString()),
    updatedAt: normalizeHistoryDate(item.updatedAt, new Date().toISOString())
  }));
}
async function readWalletHistorySnapshot(wallet) {
  const pathname = 'customer-history/' + historyWalletKey(wallet) + '.json';
  const blob = await getBlob(pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200) return { entries: [], etag: null };
  const raw = await new Response(blob.stream).text();
  const parsed = JSON.parse(raw || '[]');
  return { entries: cleanHistoryEntries(parsed), etag: blob.blob?.etag || null };
}
async function readWalletHistory(wallet) {
  return (await readWalletHistorySnapshot(wallet)).entries;
}
function mergeHistoryEntries(...groups) {
  const byId = new Map();
  for (const row of groups.flat()) {
    if (!row?.id) continue;
    const previous = byId.get(row.id);
    if (!previous) { byId.set(row.id, row); continue; }
    const incomingTime = historyTimestamp(row);
    const previousTime = historyTimestamp(previous);
    const latest = incomingTime >= previousTime ? row : previous;
    byId.set(row.id, {
      ...previous,
      ...latest,
      createdAt: previous.createdAt || row.createdAt,
      updatedAt: latest.updatedAt || latest.createdAt
    });
  }
  return [...byId.values()].sort((a, b) => historyTimestamp(b) - historyTimestamp(a)).slice(0, 100);
}
async function writeWalletHistory(wallet, entries, etag) {
  const pathname = 'customer-history/' + historyWalletKey(wallet) + '.json';
  await putBlob(pathname, JSON.stringify(cleanHistoryEntries(entries)), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}),
    cacheControlMaxAge: 60
  });
}
function isBlobWriteConflict(error) {
  return [409, 412].includes(Number(error?.statusCode || error?.status)) ||
    /precondition|already exists|conflict/i.test(String(error?.name || '') + ' ' + String(error?.message || ''));
}

const localDirectPaymentRecords = new Map();
async function putUniquePrivateRecord(pathname, value) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (isProduction) {
      const error = new Error('Persistent payment-order protection is not configured. Set BLOB_READ_WRITE_TOKEN.');
      error.status = 503;
      throw error;
    }
    if (localDirectPaymentRecords.has(pathname)) return false;
    localDirectPaymentRecords.set(pathname, value);
    return true;
  }
  try {
    await putBlob(pathname, JSON.stringify(value), {
      access: 'private', contentType: 'application/json',
      allowOverwrite: false, addRandomSuffix: false
    });
    return true;
  } catch (error) {
    if (isBlobWriteConflict(error)) return false;
    throw error;
  }
}
async function readPrivateRecord(pathname) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return localDirectPaymentRecords.get(pathname) || null;
  const blob = await getBlob(pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200) return null;
  const raw = await new Response(blob.stream).text();
  return JSON.parse(raw || 'null');
}
async function updateWalletHistory(wallet, incoming) {
  // Compare-and-swap on the Blob ETag prevents concurrent devices from overwriting
  // a newer snapshot. Retry from the latest snapshot when another write wins.
  for (let attempt = 0; attempt < 6; attempt++) {
    const snapshot = await readWalletHistorySnapshot(wallet);
    const entries = mergeHistoryEntries(snapshot.entries, incoming);
    try {
      await writeWalletHistory(wallet, entries, snapshot.etag);
      return entries;
    } catch (error) {
      if (!isBlobWriteConflict(error) || attempt === 5) throw error;
    }
  }
  const error = new Error('Transaction history changed concurrently. Please retry your save.');
  error.status = 409;
  throw error;
}
app.post('/api/history/challenge', historyChallengeLimiter, (req, res) => {
  try {
    const wallet = String(req.body?.wallet || '').trim();
    const chain = req.body?.chain === 'near' ? 'near' : 'evm';
    if (!wallet || wallet.length > 128 || (chain === 'evm' && !isEvmAddress(wallet)) ||
        (chain === 'near' && !isNearAccount(wallet))) {
      return res.status(400).json({ error: 'A valid connected wallet address is required.' });
    }
    const nonce = randomBytes(32).toString('hex');
    const recipient = 'xoduspay';
    const message = 'Sign in to XoDuspay transaction history\nWallet: ' + wallet + '\nNonce: ' + nonce;
    const iat = Date.now();
    const challengeToken = signHistoryPayload({ type: 'challenge', wallet, chain, nonce, recipient, message, iat, exp: iat + 5 * 60 * 1000 });
    res.json({ message, nonce, recipient, challengeToken });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/history/verify', historyVerifyLimiter, async (req, res) => {
  try {
    const challenge = readHistoryPayload(req.body?.challengeToken);
    if (!challenge || challenge.type !== 'challenge' || !Number.isFinite(challenge.iat) ||
        !Number.isFinite(challenge.exp) || challenge.exp !== challenge.iat + 5 * 60 * 1000 ||
        Date.now() > challenge.exp || challenge.iat > Date.now() + 30000 ||
        typeof challenge.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(challenge.nonce)) {
      return res.status(401).json({ error: 'Wallet sign-in request expired. Please try again.' });
    }
    let valid = false;
    if (challenge.chain === 'evm') {
      try { valid = verifyMessage(challenge.message, String(req.body?.signature || '')).toLowerCase() === challenge.wallet.toLowerCase(); }
      catch { valid = false; }
    } else if (challenge.chain === 'near') {
      valid = await verifyNearHistorySignature({
        wallet: challenge.wallet, message: challenge.message, nonce: challenge.nonce,
        recipient: challenge.recipient, signature: req.body?.signature, publicKey: req.body?.publicKey
      });
    }
    if (!valid) return res.status(401).json({ error: 'Wallet signature could not be verified. No history was shared.' });
    if (!await consumeChallengeNonce(challenge.nonce)) {
      return res.status(401).json({ error: 'This wallet sign-in challenge has already been used. Request a new one.' });
    }
    const token = signHistoryPayload({ type: 'session', wallet: challenge.wallet, chain: challenge.chain, exp: Date.now() + 60 * 60 * 1000 });
    res.json({ token, expiresIn: 3600 });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.get('/api/history', async (req, res) => {
  try {
    const session = requireHistorySession(req);
    const entries = await readWalletHistory(session.wallet);
    res.set('Cache-Control', 'private, no-store');
    res.json({ entries });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.put('/api/history', async (req, res) => {
  try {
    const session = requireHistorySession(req);
    const incoming = cleanHistoryEntries(req.body?.entries);
    const entries = await updateWalletHistory(session.wallet, incoming);
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, count: entries.length, entries });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.post('/api/solana/rpc', async (req, res) => {
  const allowedMethods = new Set([
    'getBalance', 'getTokenAccountsByOwner', 'getAccountInfo', 'getMultipleAccounts',
    'getLatestBlockhash', 'getFeeForMessage', 'getMinimumBalanceForRentExemption',
    'sendTransaction', 'getSignatureStatuses', 'getTransaction', 'getBlockHeight',
    'getSlot', 'getEpochInfo', 'simulateTransaction', 'isBlockhashValid'
  ]);
  const payload = req.body;
  if (!payload || typeof payload.method !== 'string' || !allowedMethods.has(payload.method)) {
    return res.status(400).json({ error: { code: -32600, message: 'Unsupported Solana RPC method.' } });
  }
  const endpoints = [
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet.solana.com',
    'https://api.mainnet-beta.solana.com'
  ];
  let lastStatus = 502;
  let lastMessage = 'No Solana RPC provider responded.';
  for (const endpoint of endpoints) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });
      const body = await upstream.text();
      if (upstream.ok) {
        res.status(200);
        res.set('Content-Type', 'application/json');
        return res.send(body);
      }
      lastStatus = upstream.status;
      lastMessage = `Solana RPC provider returned HTTP ${upstream.status}.`;
      console.error('[Solana RPC] upstream rejected request', { endpoint, method: payload.method, status: upstream.status });
    } catch (error) {
      lastMessage = String(error?.message || error).slice(0, 300);
      console.error('[Solana RPC] upstream request failed', { endpoint, method: payload.method, message: lastMessage });
    }
  }
  return res.status(502).json({ error: { code: -32000, message: lastMessage, upstreamStatus: lastStatus } });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'xoduspay-api' }));

app.get('/api/config', (_req, res) => res.json({
  oneClickConfigured: Boolean(process.env.ONECLICK_JWT),
  provider: '1Click mainnet', network: 'mainnet'
}));

app.get('/api/tokens', async (_req, res) => {
  try { res.json(await getTokens()); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});


app.post('/api/quote', quoteLimiter, async (req, res) => {
  try {
    const tokens = await getTokens();
    const input = validateQuoteBody(req.body, tokens);
    const request = {
      dry: req.body?.dry === true,
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
      referral: 'xoduspay'
    };
    // Check the authoritative USD estimate with a dry quote first. Only create
    // a deposit address after the minimum has passed.
    let dryData;
    try {
      dryData = await oneClick('/quote', {
        method: 'POST', body: JSON.stringify({ ...request, dry: true })
      });
    } catch (firstError) {
      if (!firstError.retryable && firstError.status) throw firstError;
      await new Promise(resolve => setTimeout(resolve, firstError.retryAfterMs || 900));
      dryData = await oneClick('/quote', {
        method: 'POST', body: JSON.stringify({ ...request, dry: true })
      });
    }
    const dryInputUsd = Number(dryData?.quote?.amountInUsd);
    if (!Number.isFinite(dryInputUsd) || dryInputUsd <= 0) {
      return res.status(400).json({ error: '1Click did not return a valid positive USD input estimate. Please try again.' });
    }
    let data = dryData;
    if (req.body?.dry !== true) {
      data = await oneClick('/quote', {
        method: 'POST', body: JSON.stringify({ ...request, dry: false })
      });
      const committedInputUsd = Number(data?.quote?.amountInUsd);
      if (!Number.isFinite(committedInputUsd) || committedInputUsd <= 0) {
        return res.status(409).json({ error: 'The live quote returned an invalid or zero USD input amount. Please request a fresh quote.' });
      }
      if (!data?.quote?.depositAddress || !data?.quote?.amountIn) {
        return res.status(502).json({ error: '1Click returned an incomplete committed quote. No payment should be sent.' });
      }
      // Enforce the deadline requested from 1Click. Never display or accept a
      // later provider deadline than the ten-minute checkout window requested.
      const requestedDeadlineMs = Date.parse(request.deadline);
      const providerDeadlineMs = Date.parse(data.quote.deadline || '');
      const effectiveDeadlineMs = Number.isFinite(providerDeadlineMs)
        ? Math.min(providerDeadlineMs, requestedDeadlineMs)
        : requestedDeadlineMs;
      data = {
        ...data,
        quote: {
          ...data.quote,
          deadline: new Date(effectiveDeadlineMs).toISOString()
        }
      };
    }
    res.json({ ...data, xoduspay: { origin: input.origin, destination: input.destination } });
  } catch (error) {
    const bridgeMinimum = String(error.providerMessage || '').match(/(?:try\s+at\s+least|minimum(?:\s+amount)?(?:\s+is)?\s*[:=]?)\s*([0-9]+)/i);
    if (bridgeMinimum) {
      const minimumAtomic = bridgeMinimum[1];
      const amountToken = input.swapType === 'EXACT_OUTPUT' ? input.destination : input.origin;
      const formattedMinimum = formatAtomicAmount(minimumAtomic, amountToken.decimals);
      const usdValue = Number(amountToken.price) > 0
        ? Number(minimumAtomic) / (10 ** Number(amountToken.decimals)) * Number(amountToken.price)
        : null;
      const minimumLabel = formattedMinimum
        ? formattedMinimum + ' ' + amountToken.symbol
        : minimumAtomic + ' base units';
      const usdLabel = Number.isFinite(usdValue) && usdValue > 0 ? ' (approximately , paymentActionLimiter, async (req, res) => {
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

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`XoDuspay API listening on :${PORT}`));

export default app;
 + usdValue.toFixed(4) + ' USD)' : '';
      return res.status(400).json({
        error: 'This NEAR Intents route requires at least ' + minimumLabel + usdLabel + '. This is a bridge/solver minimum for the selected route, not a XoDuspay-wide minimum. No deposit address was created. Try a higher amount or another supported route.',
        minimumAmount: minimumAtomic,
        minimumFormatted: formattedMinimum,
        minimumUsd: usdValue,
        minimumAsset: amountToken.assetId,
        minimumSymbol: amountToken.symbol,
        minimumDecimals: amountToken.decimals,
        routeMinimum: true
      });
    }
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post('/api/deposit/submit', paymentActionLimiter, async (req, res) => {
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

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`XoDuspay API listening on :${PORT}`));

export default app;
