import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createHash, createHmac, randomBytes, timingSafeEqual, createPublicKey, verify as verifySignature } from 'node:crypto';
import { verifyMessage, JsonRpcProvider, Interface, isAddress } from 'ethers';
import { get as getBlob, put as putBlob } from '@vercel/blob';

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



function historySecret() {
  const secret = process.env.XODUSPAY_HISTORY_SECRET || process.env.INTENTPAY_HISTORY_SECRET;
  if (!secret) {
    const error = new Error('Wallet history authentication is not configured.');
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
  return (data.result?.keys || []).some(item => item.public_key === publicKey);
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
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString()
  }));
}
async function readWalletHistory(wallet) {
  const pathname = 'customer-history/' + historyWalletKey(wallet) + '.json';
  const blob = await getBlob(pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200) return [];
  const raw = await new Response(blob.stream).text();
  const parsed = JSON.parse(raw || '[]');
  return cleanHistoryEntries(parsed);
}
function mergeHistoryEntries(...groups) {
  const byId = new Map();
  for (const row of groups.flat()) {
    if (!row?.id) continue;
    const previous = byId.get(row.id);
    if (!previous) { byId.set(row.id, row); continue; }
    const incomingTime = Date.parse(row.updatedAt || row.createdAt || 0);
    const previousTime = Date.parse(previous.updatedAt || previous.createdAt || 0);
    const latest = incomingTime >= previousTime ? row : previous;
    byId.set(row.id, {
      ...previous,
      ...latest,
      createdAt: previous.createdAt || row.createdAt,
      updatedAt: latest.updatedAt || latest.createdAt
    });
  }
  return [...byId.values()].sort((a, b) =>
    Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)
  ).slice(0, 100);
}
async function writeWalletHistory(wallet, entries) {
  const pathname = 'customer-history/' + historyWalletKey(wallet) + '.json';
  await putBlob(pathname, JSON.stringify(cleanHistoryEntries(entries)), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
}
app.post('/api/history/challenge', (req, res) => {
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
    const challengeToken = signHistoryPayload({ type: 'challenge', wallet, chain, nonce, recipient, message, iat: Date.now() });
    res.json({ message, nonce, recipient, challengeToken });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/history/verify', async (req, res) => {
  try {
    const challenge = readHistoryPayload(req.body?.challengeToken);
    if (!challenge || challenge.type !== 'challenge' || Date.now() - challenge.iat > 5 * 60 * 1000 ||
        challenge.iat > Date.now() + 30000) {
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
    const existing = await readWalletHistory(session.wallet);
    const entries = mergeHistoryEntries(existing, incoming);
    await writeWalletHistory(session.wallet, entries);
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, count: entries.length, entries });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
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


app.post('/api/quote', async (req, res) => {
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
    const data = await oneClick('/quote', { method: 'POST', body: JSON.stringify(request) });
    const inputUsd = Number(data?.quote?.amountInUsd);
    if (!Number.isFinite(inputUsd) || inputUsd < 0.01) {
      return res.status(400).json({ error: Number.isFinite(inputUsd)
        ? 'Minimum payment amount is $0.01 USD equivalent.'
        : '1Click did not return a valid USD input estimate, so the $0.01 minimum cannot be verified. Please try again.' });
    }
    if (req.body?.dry !== true && (!data?.quote?.depositAddress || !data?.quote?.amountIn)) {
      return res.status(502).json({ error: '1Click returned an incomplete committed quote. No payment should be sent.' });
    }
    res.json({ ...data, intentpay: { origin: input.origin, destination: input.destination } });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

const EVM_CHAIN_CONFIG = {
  1: { keys: ['eth', 'ethereum'], rpc: 'https://cloudflare-eth.com' },
  8453: { keys: ['base'], rpc: 'https://mainnet.base.org' },
  42161: { keys: ['arb', 'arbitrum'], rpc: 'https://arb1.arbitrum.io/rpc' },
  10: { keys: ['op', 'optimism'], rpc: 'https://mainnet.optimism.io' },
  137: { keys: ['polygon'], rpc: 'https://polygon-rpc.com' },
  56: { keys: ['bsc', 'bnb'], rpc: 'https://bsc-dataseed.binance.org' },
  43114: { keys: ['avax', 'avalanche'], rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  100: { keys: ['gnosis'], rpc: 'https://rpc.gnosischain.com' },
  534352: { keys: ['scroll'], rpc: 'https://rpc.scroll.io' },
  1313161554: { keys: ['aurora'], rpc: 'https://mainnet.aurora.dev' },
  80094: { keys: ['bera', 'berachain'], rpc: 'https://rpc.berachain.com' }
};

const EVM_CHAIN_IDS = {
  eth: 1, ethereum: 1, base: 8453, arb: 42161, arbitrum: 42161,
  op: 10, optimism: 10, polygon: 137, bsc: 56, bnb: 56,
  avax: 43114, avalanche: 43114, gnosis: 100, scroll: 534352,
  aurora: 1313161554, bera: 80094, berachain: 80094
};

app.post('/api/lifi/quote', async (req, res) => {
  try {
    const { originAsset, destinationAsset, amount, user, recipient, fixedOutput = false } = req.body || {};
    if (!originAsset || !destinationAsset || !/^\\d+$/.test(String(amount || '')) ||
        !isAddress(user || '') || !isAddress(recipient || '')) {
      return res.status(400).json({ error: 'Valid EVM assets, wallet addresses, and token amount are required.' });
    }
    const tokens = await getTokens();
    const origin = getToken(tokens, originAsset);
    const destination = getToken(tokens, destinationAsset);
    if (!origin || !destination) return res.status(400).json({ error: 'Selected token is not in the live token registry.' });
    const originChainId = EVM_CHAIN_IDS[String(origin.blockchain || '').toLowerCase()];
    const destinationChainId = EVM_CHAIN_IDS[String(destination.blockchain || '').toLowerCase()];
    if (!originChainId || !destinationChainId || !EVM_CHAIN_CONFIG[originChainId] || !EVM_CHAIN_CONFIG[destinationChainId]) {
      return res.status(400).json({ error: 'LI.FI fallback is limited to supported EVM-to-EVM routes. NEAR routes stay on NEAR Intents.' });
    }
    const fromToken = origin.contractAddress || '0x0000000000000000000000000000000000000000';
    const toToken = destination.contractAddress || '0x0000000000000000000000000000000000000000';
    if ((origin.contractAddress && !isAddress(origin.contractAddress)) ||
        (destination.contractAddress && !isAddress(destination.contractAddress))) {
      return res.status(400).json({ error: 'Token registry returned an invalid EVM token contract.' });
    }
    const params = new URLSearchParams({
      fromChain: String(originChainId), toChain: String(destinationChainId),
      fromToken, toToken, [fixedOutput ? 'toAmount' : 'fromAmount']: String(amount), fromAddress: user,
      toAddress: recipient, slippage: '0.01', order: 'RECOMMENDED', integrator: 'xoduspay'
    });
    const headers = { Accept: 'application/json' };
    if (process.env.LIFI_API_KEY) headers['x-lifi-api-key'] = process.env.LIFI_API_KEY;
    const response = await fetch('https://li.quest/v1/quote' + (fixedOutput ? '/toAmount' : '') + '?' + params.toString(), { headers });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'LI.FI could not find an executable route for this amount.');
      error.status = response.status;
      throw error;
    }
    const estimate = data.estimate || {};
    const tx = data.transactionRequest;
    if (!tx?.to || !tx?.data || estimate.toAmount == null || !estimate.approvalAddress && origin.contractAddress) {
      return res.status(502).json({ error: 'LI.FI returned an incomplete transaction quote. No payment should be sent.' });
    }
    const inputUsd = Number(estimate.fromAmountUSD);
    if (!Number.isFinite(inputUsd) || inputUsd < 0.01) {
      return res.status(400).json({ error: 'LI.FI could not verify the $0.01 minimum for this payment.' });
    }
    res.json({
      provider: 'lifi', transactionRequest: tx, approvalAddress: estimate.approvalAddress || null,
      quote: {
        amountIn: String(estimate.fromAmount ?? amount),
        amountOut: String(estimate.toAmount),
        amountInFormatted: estimate.fromAmount,
        amountOutFormatted: estimate.toAmount,
        amountInUsd: String(inputUsd),
        deadline: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        timeEstimate: estimate.executionDuration
      },
      lifi: { tool: data.toolDetails?.name || data.tool, bridge: data.toolDetails?.key || data.toolDetails?.name || data.tool, fromChain: originChainId, toChain: destinationChainId, route: data.includedSteps || [] }
    });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'LI.FI could not quote this EVM route.' });
  }
});

app.get('/api/lifi/status', async (req, res) => {
  try {
    const { txHash, fromChain, toChain, bridge } = req.query;
    if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
        !/^\\d+$/.test(String(fromChain || '')) || !/^\\d+$/.test(String(toChain || ''))) {
      return res.status(400).json({ error: 'A valid transaction hash and EVM chain IDs are required.' });
    }
    const params = new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) });
    if (typeof bridge === 'string' && bridge) params.set('bridge', bridge);
    const headers = { Accept: 'application/json' };
    if (process.env.LIFI_API_KEY) headers['x-lifi-api-key'] = process.env.LIFI_API_KEY;
    const response = await fetch('https://li.quest/v1/status?' + params.toString(), { headers });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
    if (!response.ok) return res.status(response.status).json({ error: data.message || data.error || 'Could not read LI.FI payment status.' });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) { res.status(502).json({ error: error.message || 'Could not read LI.FI payment status.' }); }
});

const transferLogInterface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

app.post('/api/direct-payment/verify', async (req, res) => {
  const { txHash, chainId, assetId, sender, recipient, amount } = req.body || {};
  const config = EVM_CHAIN_CONFIG[Number(chainId)];
  if (!config || typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
      typeof assetId !== 'string' || typeof amount !== 'string' || !/^\\d+$/.test(amount) ||
      !isAddress(sender || '') || !isAddress(recipient || '') || BigInt(amount) <= 0n) {
    return res.status(400).json({ verified: false, error: 'A valid transaction hash, supported chain, token, sender, recipient, and amount are required.' });
  }
  try {
    const tokens = await getTokens();
    const token = getToken(tokens, assetId);
    if (!token || !config.keys.includes(String(token.blockchain || '').toLowerCase()) ||
        !isAddress(token.contractAddress || '') || token.contractAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return res.status(400).json({ verified: false, error: 'The token is not a supported ERC-20 asset on the selected network.' });
    }
    const provider = new JsonRpcProvider(config.rpc, Number(chainId), { staticNetwork: true });
    const [network, tx, receipt, latestBlock] = await Promise.all([
      provider.getNetwork(), provider.getTransaction(txHash), provider.getTransactionReceipt(txHash), provider.getBlockNumber()
    ]);
    if (Number(network.chainId) !== Number(chainId)) throw new Error('RPC network does not match the requested chain.');
    if (!tx || !receipt) return res.status(202).json({ verified: false, pending: true, error: 'Transaction is not yet visible on the selected network.' });
    if (receipt.status !== 1) return res.status(400).json({ verified: false, error: 'The transaction reverted on-chain.' });
    if (tx.from.toLowerCase() !== sender.toLowerCase() ||
        !tx.to || tx.to.toLowerCase() !== token.contractAddress.toLowerCase()) {
      return res.status(400).json({ verified: false, error: 'Transaction sender or token contract does not match this checkout.' });
    }
    const confirmations = latestBlock - receipt.blockNumber + 1;
    if (confirmations < 2) return res.status(202).json({ verified: false, pending: true, confirmations, error: 'Waiting for a second block confirmation.' });
    const matchingTransfer = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== token.contractAddress.toLowerCase()) return false;
      try {
        const parsed = transferLogInterface.parseLog(log);
        return parsed && parsed.args.from.toLowerCase() === sender.toLowerCase() &&
          parsed.args.to.toLowerCase() === recipient.toLowerCase() &&
          parsed.args.value === BigInt(amount);
      } catch { return false; }
    });
    if (!matchingTransfer) return res.status(400).json({ verified: false, error: 'No exact ERC-20 transfer to the merchant was found in this transaction.' });
    res.set('Cache-Control', 'no-store');
    res.json({ verified: true, status: 'SUCCESS', txHash, chainId: Number(chainId), confirmations, token: token.symbol, recipient });
  } catch (error) {
    res.status(error.status || 502).json({ verified: false, error: error.message || 'Could not verify the EVM transaction.' });
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

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`XoDuspay API listening on :${PORT}`));

export default app;
