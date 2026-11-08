import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, Contract, Interface, formatUnits, isAddress, parseUnits } from 'ethers';
import { actionCreators, setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupNearMobileWallet } from '@near-wallet-selector/near-mobile-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupMeteorWalletApp } from '@near-wallet-selector/meteor-wallet-app';
import { setupHotWallet } from '@near-wallet-selector/hot-wallet';
import { setupSender } from '@near-wallet-selector/sender';
import '@near-wallet-selector/modal-ui/styles.css';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import MerchantTools from './MerchantTools.jsx';
import LandingPage from './LandingPage.jsx';

const CHAIN_IDS = {
  eth: 1, ethereum: 1, base: 8453, arb: 42161, arbitrum: 42161,
  op: 10, optimism: 10, polygon: 137, bsc: 56, avax: 43114,
  avalanche: 43114, gnosis: 100, bera: 80094, berachain: 80094,
  scroll: 534352, aurora: 1313161554
};
const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address owner) view returns (uint256)'];
const ERC20_TRANSFER_INTERFACE = new Interface(['function transfer(address to, uint256 amount)']);
const NATIVE_SYMBOL = {1:'ETH',8453:'ETH',42161:'ETH',10:'ETH',137:'POL',56:'BNB',43114:'AVAX',100:'xDAI',80094:'BERA',534352:'ETH',1313161554:'ETH'};
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT']);
const tokenChain = t => normalizeBlockchain(t?.blockchain, t?.assetId);
const isNearToken = t => tokenChain(t) === 'near';
const tokenId = t => t.assetId || '';
const tokenName = t => `${t.symbol || 'TOKEN'} · ${t.blockchain || 'Unknown chain'}`;
const chainLabel = value => ({eth:'Ethereum',arb:'Arbitrum',op:'Optimism',avax:'Avalanche',bera:'Berachain'}[value] || String(value || '').split(/[-_ ]+/).map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' '));
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
};
const TOKEN_PRIORITY = ['USDC','USDT','ETH','NEAR','DAI','WETH','WBTC','USDBC','USDE','FRAX','USDS'];
const tokenPriority = t => { const i = TOKEN_PRIORITY.indexOf(String(t.symbol || '').toUpperCase()); return i < 0 ? TOKEN_PRIORITY.length : i; };
const normalizeToken = token => {
  if (!token || typeof token !== 'object' || !token.assetId) return null;
  const blockchain = normalizeBlockchain(token.blockchain, token.assetId);
  const decimals = Number(token.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  return { ...token, blockchain, decimals };
};
const normalizeTokenList = data => {
  let value = data;
  for (let depth = 0; depth < 4 && !Array.isArray(value); depth++) {
    value = value?.tokens || value?.data || value?.result || value?.assets;
  }
  return Array.isArray(value) ? value.map(normalizeToken).filter(token => token?.blockchain) : [];
};
const short = (value = '') => value.length > 24 ? value.slice(0, 10) + '…' + value.slice(-8) : value;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const usdToTokenAtomic = (usdAmount, token) => {
  const usd = Number(usdAmount);
  const price = Number(token?.price);
  const decimals = Number(token?.decimals);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Enter a valid fixed USD amount.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('A live USD price is not available for the merchant payout token. Choose another supported token and try again.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('The selected payout token has invalid decimal precision.');
  const fraction = value => {
    const [mantissa, exponentText] = String(value).toLowerCase().split('e');
    const exponent = Number(exponentText || 0);
    const [whole, fractional = ''] = mantissa.split('.');
    const numerator = BigInt(whole + fractional);
    const scale = fractional.length - exponent;
    return scale >= 0
      ? [numerator, 10n ** BigInt(scale)]
      : [numerator * (10n ** BigInt(-scale)), 1n];
  };
  const [usdNumerator, usdDenominator] = fraction(usdAmount);
  const [priceNumerator, priceDenominator] = fraction(token.price);
  const numerator = usdNumerator * priceDenominator * (10n ** BigInt(decimals));
  const denominator = usdDenominator * priceNumerator;
  if (numerator <= 0n || denominator <= 0n) throw new Error('Could not convert the fixed USD price into the selected payout token.');
  return ((numerator + denominator - 1n) / denominator).toString();
};



export default function App() {
  const path = window.location.pathname;
  const checkoutParams = new URLSearchParams(window.location.search);
  const isHostedWidgetCheckout = Boolean(checkoutParams.get('merchantAsset') && checkoutParams.get('merchantRecipient'));
  if (path === '/merchant' || path === '/merchant/') return <MerchantApp merchantOnly />;
  if (path === '/checkout' || path === '/checkout/') return <MerchantApp checkoutOnly />;
  if (isHostedWidgetCheckout) return <MerchantApp checkoutOnly />;
  return <LandingPage />;
}

function MerchantApp({ merchantOnly = false, checkoutOnly = false }) {
  const checkoutParams = new URLSearchParams(window.location.search);
  const merchantAssetParam = checkoutParams.get('merchantAsset') || '';
  const merchantRecipientParam = checkoutParams.get('merchantRecipient') || '';
  const merchantNameParam = (checkoutParams.get('merchantName') || '').trim();
  const merchantPurposeParam = (checkoutParams.get('merchantPurpose') || '').trim();
  const merchantAmountParam = checkoutParams.get('merchantAmountUsd') || checkoutParams.get('merchantAmount') || '';
  const isWidgetCheckout = Boolean(merchantAssetParam && merchantRecipientParam);
  const isFixedWidgetCheckout = isWidgetCheckout && Boolean(merchantAmountParam && Number(merchantAmountParam) > 0);
  const [health, setHealth] = useState('Checking service…');
  const [configured, setConfigured] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [wallet, setWallet] = useState('');
  const [nearWallet, setNearWallet] = useState('');
  const [nearSelector, setNearSelector] = useState(null);
  const [nearModal, setNearModal] = useState(null);
  const [walletAction, setWalletAction] = useState('');
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletFeedback, setWalletFeedback] = useState('Choose a wallet to connect.');
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [followMenuOpen, setFollowMenuOpen] = useState(false);
  const [merchantWorkspaceOpen, setMerchantWorkspaceOpen] = useState(new URLSearchParams(window.location.search).get('workspace') === 'merchant');
  const [originChain, setOriginChain] = useState('');
  const [originAsset, setOriginAsset] = useState('');
  const [originSearch, setOriginSearch] = useState('');
  const [walletTokenBalances, setWalletTokenBalances] = useState({});
  const [walletTokenScan, setWalletTokenScan] = useState({ loading: false, error: '', complete: false });
  const [destinationChain, setDestinationChain] = useState('');
  const [destinationAsset, setDestinationAsset] = useState(merchantAssetParam);
  const [amount, setAmount] = useState(merchantAmountParam);
  const [originBalance, setOriginBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [recipient, setRecipient] = useState(merchantRecipientParam);
  const [quote, setQuote] = useState(null);
  const [quoteClock, setQuoteClock] = useState(Date.now());
  const [gasEstimate, setGasEstimate] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [paymentStatus, setSwapStatus] = useState('');
  const [customerHistory, setCustomerHistory] = useState([]);
  const [historyAuth, setHistoryAuth] = useState({ account: '', token: '', status: 'idle', error: '' });
  const [historySyncRequested, setHistorySyncRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Connect your EVM or NEAR mainnet wallet, choose the asset you will pay with, and set the merchant payout details.');
  const quoteRequestRef = useRef(0);

  // Update the displayed countdown against the provider-issued expiry deadline.
  useEffect(() => {
    if (!quote?.quote?.deadline) return undefined;
    const tick = () => setQuoteClock(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [quote?.quote?.deadline]);

  const quoteSecondsRemaining = quote?.quote?.deadline
    ? Math.max(0, Math.ceil((Date.parse(quote.quote.deadline) - quoteClock) / 1000))
    : null;
  const quoteExpired = quoteSecondsRemaining === 0;
  const quoteCountdownLabel = quoteSecondsRemaining === null
    ? 'Provider-defined'
    : `${Math.floor(quoteSecondsRemaining / 60)}:${String(quoteSecondsRemaining % 60).padStart(2, '0')}`;
  const evmProvidersRef = useRef([]);
  const activeEvmProviderRef = useRef(null);
  const walletConnectProviderRef = useRef(null);
  const siteMenuWrapRef = useRef(null);
  const walletMenuWrapRef = useRef(null);
  const followMenuWrapRef = useRef(null);

  // Dismiss open menus when the user taps outside them or presses Escape.
  useEffect(() => {
    if (!siteMenuOpen && !walletMenuOpen && !followMenuOpen) return undefined;
    const handlePointerDown = event => {
      if (siteMenuOpen && !siteMenuWrapRef.current?.contains(event.target)) { setSiteMenuOpen(false); setFollowMenuOpen(false); }
      if (walletMenuOpen && !walletMenuWrapRef.current?.contains(event.target)) setWalletMenuOpen(false);
      if (followMenuOpen && !followMenuWrapRef.current?.contains(event.target)) setFollowMenuOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setSiteMenuOpen(false);
        setFollowMenuOpen(false);
        setWalletMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [siteMenuOpen, walletMenuOpen, followMenuOpen]);

  useEffect(() => {
    const announce = event => {
      const detail = event?.detail;
      if (!detail?.provider || !detail?.info) return;
      const key = detail.info.uuid || detail.info.rdns || detail.info.name;
      if (!evmProvidersRef.current.some(item => (item.info.uuid || item.info.rdns || item.info.name) === key)) {
        evmProvidersRef.current.push(detail);
      }
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);


  // Restore an already-authorized EVM account silently; never trigger a wallet login prompt.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (cancelled || wallet || nearWallet) return;
      const injected = window.ethereum;
      const providers = [
        ...evmProvidersRef.current.map(item => item.provider),
        ...(Array.isArray(injected?.providers) ? injected.providers : []),
        ...(injected ? [injected] : [])
      ].filter((provider, index, all) => provider?.request && all.indexOf(provider) === index);
      for (const provider of providers) {
        try {
          const accounts = await provider.request({ method: 'eth_accounts' });
          if (!cancelled && Array.isArray(accounts) && accounts[0]) {
            activeEvmProviderRef.current = provider;
            setWallet(accounts[0]);
            setWalletFeedback('Previously connected wallet restored.');
            setNotice('Your connected EVM wallet was restored. Choose your payment asset without signing in again.');
            return;
          }
        } catch {}
      }
    };
    restore();
    return () => { cancelled = true; };
  }, [wallet, nearWallet]);

  // Restore an already-authorized EVM account silently; never prompt for a new login.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (cancelled || wallet || nearWallet) return;
      const injected = window.ethereum;
      const providers = [
        ...evmProvidersRef.current.map(item => item.provider),
        ...(Array.isArray(injected?.providers) ? injected.providers : []),
        ...(injected ? [injected] : [])
      ].filter((provider, index, all) => provider?.request && all.indexOf(provider) === index);
      for (const provider of providers) {
        try {
          const accounts = await provider.request({ method: 'eth_accounts' });
          if (!cancelled && Array.isArray(accounts) && accounts[0]) {
            activeEvmProviderRef.current = provider;
            setWallet(accounts[0]);
            setWalletFeedback('Previously connected wallet restored.');
            setNotice('Your connected EVM wallet was restored. Choose your payment asset without signing in again.');
            return;
          }
        } catch {}
      }
    };
    restore();
    return () => { cancelled = true; };
  }, [wallet, nearWallet]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('intentpay_pending_near');
      if (saved) {
        const pending = JSON.parse(saved);
        if (pending?.quote?.quote?.deadline && Date.parse(pending.quote.quote.deadline) > Date.now()) {
          setQuote(pending.quote);
          setOriginAsset(pending.originAsset || '');
          setDestinationAsset(pending.destinationAsset || '');
          setRecipient(pending.recipient || '');
          setTxHash('NEAR wallet approval pending — check status');
          setNotice('Returned from your NEAR wallet. Refresh payment status before attempting another deposit.');
        } else sessionStorage.removeItem('intentpay_pending_near');
      }
    } catch { sessionStorage.removeItem('intentpay_pending_near'); }
    let active = true;
    (async () => {
      try {
        const selector = await setupWalletSelector({
          network: 'mainnet',
          optimizeWalletOrder: true,
          modules: [
            setupNearMobileWallet(),
            setupMeteorWallet(),
            setupMeteorWalletApp({ contractId: 'wrap.near' }),
            setupHotWallet(),
            setupSender(),
            setupMyNearWallet()
          ]
        });
        const modal = setupModal(selector, { contractId: 'wrap.near' });
        if (!active) return;
        setNearSelector(selector);
        setNearModal(modal);
        setNearWallet(selector.store.getState().accounts[0]?.accountId || '');
        selector.store.observable.subscribe(state => setNearWallet(state.accounts[0]?.accountId || ''));
      } catch (error) { if (active) setNotice(`NEAR wallet setup failed: ${error.message}`); }
    })();
    fetch('/api/health').then(r => r.json()).then(d => setHealth(d.ok ? 'API online' : 'API unavailable')).catch(() => setHealth('Backend unavailable'));
    fetch('/api/config').then(r => r.json()).then(d => setConfigured(Boolean(d.oneClickConfigured))).catch(() => {});
    fetch('/api/tokens').then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not load token registry.');
      const list = normalizeTokenList(data);
      if (!list.length) throw new Error('The live NEAR Intents token registry returned no usable assets. Refresh and try again.');
      setTokens(list);
    }).catch(e => setNotice(e.message)).finally(() => setLoadingTokens(false));
    return () => { active = false; };
  }, []);

  const origin = useMemo(() => tokens.find(t => tokenId(t) === originAsset), [tokens, originAsset]);
  const destination = useMemo(() => tokens.find(t => tokenId(t) === destinationAsset), [tokens, destinationAsset]);
  const customerAccount = isNearToken(origin || {}) ? nearWallet : wallet;

  const historyStorageKey = customerAccount ? 'intentpay_customer_history_' + customerAccount.toLowerCase() : '';
  useEffect(() => {
    if (!historyStorageKey) { setCustomerHistory([]); return; }
    try {
      const saved = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
      setCustomerHistory(Array.isArray(saved) ? saved : []);
    } catch { setCustomerHistory([]); }
  }, [historyStorageKey]);

  function mergeHistoryRows(...groups) {
    const byId = new Map();
    for (const row of groups.flat()) {
      if (!row?.id) continue;
      const previous = byId.get(row.id);
      byId.set(row.id, previous ? { ...previous, ...row,
        createdAt: previous.createdAt || row.createdAt,
        updatedAt: (Date.parse(row.updatedAt || row.createdAt || 0) >= Date.parse(previous.updatedAt || previous.createdAt || 0)) ? (row.updatedAt || row.createdAt) : previous.updatedAt
      } : row);
    }
    return [...byId.values()].sort((x,y) => Date.parse(y.updatedAt || y.createdAt || 0) - Date.parse(x.updatedAt || x.createdAt || 0)).slice(0,100);
  }

  useEffect(() => {
    let cancelled = false;
    if (!customerAccount) {
      setHistoryAuth({ account: '', token: '', status: 'idle', error: '' });
      return undefined;
    }
    if (!historySyncRequested) {
      if (historyAuth.account !== customerAccount) setHistoryAuth({ account: customerAccount, token: '', status: 'idle', error: '' });
      return undefined;
    }
    const account = customerAccount;
    const chain = isNearToken(origin || {}) ? 'near' : 'evm';
    setHistoryAuth({ account, token: '', status: 'signing', error: '' });
    (async () => {
      const challengeResponse = await fetch('/api/history/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: account, chain })
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error || 'Could not start wallet sign-in.');
      let signature = '';
      let publicKey = '';
      if (chain === 'near') {
        if (!nearSelector) throw new Error('NEAR wallet is still initializing. Try again in a moment.');
        const walletApi = await nearSelector.wallet();
        const nonce = new Uint8Array(challenge.nonce.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        const signed = await walletApi.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce });
        const result = signed?.response || signed;
        signature = result?.signature || '';
        publicKey = result?.publicKey || '';
        if (result?.accountId && result.accountId !== account) throw new Error('The NEAR wallet signed with a different account.');
      } else {
        const provider = activeEvmProviderRef.current || walletConnectProviderRef.current || window.ethereum;
        if (!provider?.request) throw new Error('Reconnect your EVM wallet to securely sync transaction history.');
        signature = await provider.request({ method: 'personal_sign', params: [challenge.message, account] });
      }
      const verifyResponse = await fetch('/api/history/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge.challengeToken, signature, publicKey })
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verified.error || 'Wallet sign-in failed.');
      const authHeaders = { Authorization: 'Bearer ' + verified.token };
      const cloudResponse = await fetch('/api/history', { headers: authHeaders });
      const cloud = await cloudResponse.json();
      if (!cloudResponse.ok) throw new Error(cloud.error || 'Could not load synced transaction history.');
      let localRows = [];
      try { localRows = JSON.parse(localStorage.getItem('intentpay_customer_history_' + account.toLowerCase()) || '[]'); } catch {}
      const merged = mergeHistoryRows(Array.isArray(cloud.entries) ? cloud.entries : [], Array.isArray(localRows) ? localRows : []);
      if (cancelled) return;
      setCustomerHistory(merged);
      localStorage.setItem('intentpay_customer_history_' + account.toLowerCase(), JSON.stringify(merged));
      await fetch('/api/history', {
        method: 'PUT', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: merged })
      });
      if (!cancelled) { setHistoryAuth({ account, token: verified.token, status: 'ready', error: '' }); setHistorySyncRequested(false); }
    })().catch(error => {
      if (!cancelled) { setHistoryAuth({ account, token: '', status: 'error', error: error?.message || 'Wallet history sync failed.' }); setHistorySyncRequested(false); }
    });
    return () => { cancelled = true; };
  }, [customerAccount, nearSelector, origin, historySyncRequested]);

  function saveCustomerHistory(entry) {
    const account = entry.account || customerAccount;
    if (!account) return;
    const key = 'intentpay_customer_history_' + account.toLowerCase();
    try {
      const previous = JSON.parse(localStorage.getItem(key) || '[]');
      const rows = mergeHistoryRows(previous, [{ ...entry, createdAt: entry.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }]);
      localStorage.setItem(key, JSON.stringify(rows));
      if (account.toLowerCase() === customerAccount?.toLowerCase()) setCustomerHistory(rows);
      if (historyAuth.account.toLowerCase() === account.toLowerCase() && historyAuth.token) {
        fetch('/api/history', {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + historyAuth.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: rows })
        }).then(async response => {
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Cloud history update failed.'); }
        }).catch(error => setNotice('Payment status updated, but cloud history sync failed: ' + error.message));
      }
    } catch { setNotice('Payment submitted, but transaction history could not be saved.'); }
  }

  function recordCurrentPayment(status, hash = txHash, paymentQuote = quote) {
    if (!paymentQuote?.quote || !origin || !destination || !customerAccount) return;
    const paymentId = paymentQuote.quote.depositAddress;
    if (!paymentId) return;
    saveCustomerHistory({
      id: paymentId,
      account: customerAccount,
      merchant: merchantNameParam || 'Merchant payment',
      purpose: merchantPurposeParam,
      sourceNetwork: chainLabel(tokenChain(origin)),
      sourceToken: origin.symbol || 'TOKEN',
      destinationNetwork: chainLabel(tokenChain(destination)),
      destinationToken: destination.symbol || 'TOKEN',
      amountPaid: paymentQuote.quote.amountInFormatted || (paymentQuote.quote.amountIn != null ? formatUnits(paymentQuote.quote.amountIn, Number(origin.decimals || 0)) : ''),
      amountReceived: paymentQuote.quote.amountOutFormatted || (paymentQuote.quote.amountOut != null ? formatUnits(paymentQuote.quote.amountOut, Number(destination.decimals || 0)) : ''),
      transactionHash: hash || '',
      depositAddress: paymentQuote.quote.depositAddress || '',
      provider: 'NEAR Intents',
      status: status || 'PROCESSING',
      fixedAmount: Boolean(isFixedWidgetCheckout)
    });
  }

  // Hosted widget links carry the merchant's payout asset. Resolve its network
  // from the live registry so the customer checkout displays the merchant's
  // configured network and token without asking the customer to select them.
  useEffect(() => {
    if (!isWidgetCheckout || !tokens.length) return;
    const payout = tokens.find(t => tokenId(t) === merchantAssetParam);
    if (!payout) {
      setNotice('The merchant payout token in this checkout link is not available in the current NEAR Intents token registry.');
      return;
    }
    setDestinationChain(tokenChain(payout));
    setDestinationAsset(payout.assetId);
  }, [isWidgetCheckout, merchantAssetParam, tokens]);
  const fixedOutputCheckout = Boolean(isFixedWidgetCheckout);
  const estimateToken = fixedOutputCheckout ? destination : origin;
  const usdEstimate = amount && Number.isFinite(Number(amount)) && Number(amount) > 0
    ? (fixedOutputCheckout ? Number(amount) : (Number.isFinite(Number(origin?.price)) && Number(origin.price) > 0 ? Number(amount) * Number(origin.price) : null))
    : null;
  const origins = useMemo(() => tokens.filter(t => CHAIN_IDS[tokenChain(t)] || isNearToken(t)), [tokens]);
  const originChains = useMemo(() => [...new Set([...origins.map(tokenChain), 'near'])].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [origins]);
  const originTokens = useMemo(() => origins.filter(t => tokenChain(t) === originChain).sort((a, b) => tokenPriority(a) - tokenPriority(b) || String(a.symbol || '').localeCompare(String(b.symbol || ''))), [origins, originChain]);
  const filteredOriginTokens = useMemo(() => origins
    .filter(t => !originSearch || (String(t.symbol || '') + ' ' + String(t.name || '') + ' ' + chainLabel(tokenChain(t))).toLowerCase().includes(originSearch.toLowerCase()))
    .sort((a, b) => chainLabel(tokenChain(a)).localeCompare(chainLabel(tokenChain(b))) || tokenPriority(a) - tokenPriority(b) || String(a.symbol || '').localeCompare(String(b.symbol || ''))),
  [origins, originSearch]);
  const originTokenGroups = useMemo(() => [...new Set(filteredOriginTokens.map(tokenChain))], [filteredOriginTokens]);
  const walletDetectedOriginTokens = useMemo(() => originTokens.filter(t => Number(walletTokenBalances[t.assetId] || 0) > 0), [originTokens, walletTokenBalances]);
  const otherOriginTokens = useMemo(() => originTokens.filter(t => !(Number(walletTokenBalances[t.assetId] || 0) > 0)), [originTokens, walletTokenBalances]);
  useEffect(() => {
    if (originChain) return undefined;
    if (nearWallet && !wallet && origins.some(t => tokenChain(t) === 'near')) {
      setOriginChain('near');
      return undefined;
    }
    if (!wallet || !activeEvmProviderRef.current) return undefined;
    let cancelled = false;
    new BrowserProvider(activeEvmProviderRef.current, 'any').getNetwork().then(network => {
      const matching = origins.find(t => CHAIN_IDS[tokenChain(t)] === Number(network.chainId));
      if (!cancelled && matching) setOriginChain(tokenChain(matching));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [originChain, wallet, nearWallet, origins]);
  const destinations = useMemo(() => tokens, [tokens]);
  // Merchant payout destinations must have a recipient validator in the backend.
  // Other API-listed chains remain available as customer source assets.
  const supportedPayoutChains = new Set([
    'near', 'solana',
    'eth', 'ethereum', 'base', 'arb', 'arbitrum', 'op', 'optimism',
    'polygon', 'bsc', 'bnb', 'avax', 'avalanche', 'gnosis', 'scroll',
    'aurora', 'bera', 'berachain', 'fantom', 'ftm', 'linea', 'zksync',
    'mantle', 'mode', 'blast', 'celo', 'worldchain'
  ]);
  const destinationChains = useMemo(() => [...new Set(destinations.map(tokenChain).filter(chain => supportedPayoutChains.has(chain)))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [destinations]);
  const destinationTokens = useMemo(() => destinations.filter(t => tokenChain(t) === destinationChain).sort((a, b) => tokenPriority(a) - tokenPriority(b) || String(a.symbol || '').localeCompare(String(b.symbol || ''))), [destinations, destinationChain]);
  useEffect(() => {
    let cancelled = false;
    async function scanWalletTokens() {
      setWalletTokenBalances({});
      setWalletTokenScan({ loading: false, error: '', complete: false });
      if (!originChain) return;
      const nearSource = originChain === 'near';
      const account = nearSource ? nearWallet : wallet;
      if (!account) {
        setWalletTokenScan({ loading: false, error: nearSource ? 'Connect your NEAR wallet to detect token balances.' : 'Connect your EVM wallet to detect token balances.', complete: false });
        return;
      }
      setWalletTokenScan({ loading: true, error: '', complete: false });
      try {
        const found = {};
        if (nearSource) {
          const accountArgs = btoa(JSON.stringify({ account_id: account }));
          for (const token of originTokens) {
            if (cancelled) return;
            const contractId = token.contractAddress || String(token.assetId || '').replace(/^nep141:/, '');
            if (!contractId) continue;
            const response = await fetch('https://rpc.mainnet.near.org', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 'intentpay-wallet-scan', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'ft_balance_of', args_base64: accountArgs } })
            });
            const data = await response.json();
            if (!response.ok || data.error) continue;
            const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(data.result.result)));
            const formatted = Number(formatUnits(String(raw), Number(token.decimals || 0)));
            if (Number.isFinite(formatted) && formatted > 0) found[token.assetId] = formatted;
          }
        } else {
          const providerObject = activeEvmProviderRef.current || window.ethereum;
          if (!providerObject) throw new Error('Reconnect your EVM wallet to detect token balances.');
          const provider = new BrowserProvider(providerObject, 'any');
          const network = await provider.getNetwork();
          const expectedChain = CHAIN_IDS[originChain];
          if (expectedChain && Number(network.chainId) !== expectedChain) {
            throw new Error('Your wallet is on ' + Number(network.chainId) + '. Switch it to ' + chainLabel(originChain) + ' to detect tokens on this network.');
          }
          const batchSize = 8;
          for (let offset = 0; offset < originTokens.length; offset += batchSize) {
            if (cancelled) return;
            const batch = originTokens.slice(offset, offset + batchSize);
            const results = await Promise.allSettled(batch.map(async token => {
              const raw = token.contractAddress
                ? await new Contract(token.contractAddress, ERC20_ABI, provider).balanceOf(account)
                : await provider.getBalance(account);
              const formatted = Number(formatUnits(raw, Number(token.decimals || 0)));
              return { assetId: token.assetId, balance: formatted };
            }));
            for (const result of results) {
              if (result.status === 'fulfilled' && Number.isFinite(result.value.balance) && result.value.balance > 0) {
                found[result.value.assetId] = result.value.balance;
              }
            }
          }
        }
        if (!cancelled) {
          setWalletTokenBalances(found);
          setWalletTokenScan({ loading: false, error: '', complete: true });
          if (!originAsset && Object.keys(found).length === 1) setOriginAsset(Object.keys(found)[0]);
        }
      } catch (error) {
        if (!cancelled) setWalletTokenScan({ loading: false, error: error?.message || 'Could not scan this network for wallet tokens.', complete: false });
      }
    }
    scanWalletTokens();
    return () => { cancelled = true; };
  }, [originChain, wallet, nearWallet, originTokens]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedAssetBalance() {
      setOriginBalance('');
      setBalanceError('');
      if (!origin) return;
      const nearSource = isNearToken(origin);
      const account = nearSource ? nearWallet : wallet;
      if (!account) {
        setBalanceError(nearSource ? 'Connect your NEAR wallet to see your balance.' : 'Connect your EVM wallet to see your balance.');
        return;
      }
      setBalanceLoading(true);
      try {
        let rawBalance;
        if (nearSource) {
          const contractId = origin.contractAddress || String(origin.assetId || '').replace(/^nep141:/, '');
          if (contractId) {
            const args = btoa(JSON.stringify({ account_id: account }));
            const response = await fetch('https://rpc.mainnet.near.org', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 'intentpay-balance', method: 'query',
                params: { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: 'ft_balance_of', args_base64: args }
              })
            });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error?.cause?.name || data.error?.message || 'Could not read NEAR token balance.');
            rawBalance = JSON.parse(new TextDecoder().decode(new Uint8Array(data.result.result)));
          } else {
            const response = await fetch('https://rpc.mainnet.near.org', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 'intentpay-balance', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: account } })
            });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not read NEAR account balance.');
            rawBalance = data.result.amount;
          }
        } else {
          const providerObject = activeEvmProviderRef.current || window.ethereum;
          if (!providerObject) throw new Error('Open XoDuspay inside your EVM wallet browser to read the balance.');
          const provider = new BrowserProvider(providerObject);
          const network = await provider.getNetwork();
          const expectedChain = CHAIN_IDS[tokenChain(origin)];
          if (expectedChain && Number(network.chainId) !== expectedChain) {
            throw new Error('Switch your wallet to ' + chainLabel(tokenChain(origin)) + ' to view this balance.');
          }
          if (origin.contractAddress) {
            const tokenContract = new Contract(origin.contractAddress, ERC20_ABI, provider);
            rawBalance = await tokenContract.balanceOf(account);
          } else {
            rawBalance = await provider.getBalance(account);
          }
          rawBalance = rawBalance.toString();
        }
        if (!cancelled) setOriginBalance(formatUnits(rawBalance, Number(origin.decimals || 0)));
      } catch (error) {
        if (!cancelled) setBalanceError(error?.message || 'Balance could not be loaded.');
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    }
    loadSelectedAssetBalance();
    return () => { cancelled = true; };
  }, [origin, wallet, nearWallet]);

  const destinationIsNear = destinationChain === 'near' || isNearToken(destinationTokens.find(t => t.assetId === destinationAsset) || {});
  const destinationIsSolana = destinationChain === 'solana';
  const recipientPlaceholder = destinationIsNear ? 'e.g. merchant.near' : destinationIsSolana ? 'Solana wallet address' : 'e.g. 0xAbC123...7890';

  async function connectNearWallet() {
    setWalletAction('near');
    setWalletFeedback('Opening the NEAR wallet selector…');
    try {
      if (!nearSelector || !nearModal) {
        setWalletFeedback('NEAR wallet is still initializing. Wait a moment and try again.');
        setNotice('NEAR wallet options are still initializing. Wait a moment and tap Connect NEAR again.');
        return;
      }
      nearModal.show();
      setWalletFeedback('NEAR wallet selector opened. Choose a wallet and approve the connection.');
      setNotice('Choose a NEAR wallet in the wallet window to connect your mainnet account.');
    } catch (error) {
      setWalletFeedback('NEAR connection error: ' + (error?.message || 'Unknown error'));
      setNotice('Could not open the NEAR wallet window: ' + (error?.message || 'Unknown error') + '. Try refreshing the page.');
    } finally { setWalletAction(''); }
  }

  async function connectMeteorWalletApp() {
    setWalletAction('meteor-app');
    setWalletFeedback('Requesting a direct connection from the Meteor app…');
    try {
      if (!nearSelector) throw new Error('NEAR wallet is still initializing. Refresh and try again.');
      const meteorApp = await nearSelector.wallet('meteor-wallet-app');
      const accounts = await meteorApp.signIn({ contractId: 'wrap.near' });
      const accountId = accounts?.[0]?.accountId || '';
      if (!accountId) throw new Error('Meteor did not return a NEAR account. Make sure this page is open inside the Meteor app.');
      setNearWallet(accountId);
      setWalletFeedback('Connected to Meteor Wallet App: ' + accountId);
      setNotice('Meteor Wallet App connected on NEAR mainnet.');
      setWalletMenuOpen(false);
    } catch (error) {
      const message = error?.message || 'Unknown error';
      setWalletFeedback('Meteor app connection failed: ' + message);
      setNotice('Meteor app connection failed: ' + message + '. Keep XoDuspay open inside Meteor and try again.');
    } finally {
      setWalletAction('');
    }
  }

  async function connectWallet() {
    setWalletAction('evm');
    setWalletFeedback('Checking the wallet connection…');
    let stage = 'wallet discovery';
    try {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      await new Promise(resolve => setTimeout(resolve, 1000));
      const announced = evmProvidersRef.current;
      const injected = window.ethereum;
      const injectedProviders = Array.isArray(injected?.providers) ? injected.providers : [];
      const providerName = provider => {
        const item = announced.find(entry => entry.provider === provider);
        return String(item?.info?.name || provider?.providerInfo?.name || provider?.name || 'EVM wallet');
      };
      const isZerion = provider => /zerion/i.test(providerName(provider) + ' ' + String(
        announced.find(entry => entry.provider === provider)?.info?.rdns || provider?.info?.rdns || ''
      ) + (provider?.isZerion ? ' zerion' : ''));
      // Prefer independently announced EIP-6963 wallets (MetaMask, Trust, Rabby,
      // Coinbase, etc.) before a legacy injected bridge. Zerion is supported,
      // but never gets priority merely because it owns window.ethereum.
      const announcedProviders = announced.map(item => item.provider);
      const allInjected = [...announcedProviders, ...injectedProviders, ...(injected ? [injected] : [])]
        .filter((provider, index, all) =>
          provider && typeof provider.request === 'function' && all.indexOf(provider) === index
        );
      const candidates = [
        ...allInjected.filter(provider => !isZerion(provider)),
        ...allInjected.filter(isZerion)
      ];
      const detectedNames = candidates.map(providerName);
      if (!candidates.length) {
        throw new Error('No EVM wallet was detected in this browser. Open XoDuspay inside a wallet app or use WalletConnect.');
      }
      let connected = false;
      let lastError = null;
      for (let index = 0; index < candidates.length; index++) {
        const selected = candidates[index];
        try {
          stage = 'requesting accounts from wallet ' + (index + 1) + '/' + candidates.length;
          // Use the standard EIP-1193 request interface directly. This avoids
          // ethers' provider wrapper during the wallet's permission handshake.
          const accounts = await selected.request({ method: 'eth_requestAccounts' });
          if (!Array.isArray(accounts) || !accounts.length) throw new Error('Wallet returned no accounts.');
          stage = 'reading connected account';
          const provider = new BrowserProvider(selected, 'any');
          const signer = await provider.getSigner(accounts[0]);
          const address = await signer.getAddress();
          activeEvmProviderRef.current = selected;
          setWallet(address);
          setWalletFeedback('Wallet connected successfully.');
          const item = announced.find(entry => entry.provider === selected);
          const walletName = isZerion(selected) || /zerion/i.test((item?.info?.name || '') + ' ' + (item?.info?.rdns || ''))
            ? 'Zerion' : (item?.info?.name || 'EVM');
          setNotice(walletName + ' wallet connected. Your connected address will be used as the refund address.');
          selected.on?.('accountsChanged', next => setWallet(next?.[0] || ''));
          selected.on?.('chainChanged', chainId => { setQuote(null); const matching = origins.find(t => CHAIN_IDS[tokenChain(t)] === Number(chainId)); if (matching) { setOriginChain(tokenChain(matching)); setOriginAsset(''); } });
          connected = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!connected) {
        const detail = lastError?.stack || lastError?.message || String(lastError || 'Unknown provider error');
        throw new Error(stage + ': ' + detail);
      }
    } catch (error) {
      const detail = error?.stack || error?.message || 'Unknown wallet error';
      setWalletFeedback('EVM connection failed: ' + detail);
      setNotice('EVM wallet connection failed. Diagnostic: ' + detail);
    } finally { setWalletAction(''); }
  }

  async function connectWalletConnect() {
    setWalletAction('walletconnect');
    setWalletFeedback('Starting WalletConnect…');
    try {
      const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
      if (!projectId) throw new Error('WalletConnect is not configured yet. A Reown project ID must be added as VITE_WALLETCONNECT_PROJECT_ID in Vercel before this option can connect.');
      let wc = walletConnectProviderRef.current;
      if (!wc) {
        wc = await EthereumProvider.init({
          projectId,
          optionalChains: [1, 8453, 42161, 10, 137, 56, 43114, 100, 80094, 534352, 1313161554],
          showQrModal: true,
          metadata: {
            name: 'XoDuspay',
            description: 'Universal crypto checkout powered by NEAR Intents',
            url: window.location.origin,
            icons: [window.location.origin + '/favicon.ico']
          }
        });
        walletConnectProviderRef.current = wc;
      }
      if (!wc.session) await wc.connect();
      activeEvmProviderRef.current = wc;
      const provider = new BrowserProvider(wc);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts?.length) throw new Error('WalletConnect did not return an EVM account.');
      setWallet(await (await provider.getSigner()).getAddress());
      setWalletFeedback('WalletConnect wallet connected successfully.');
      setNotice('WalletConnect wallet connected. Your address will be used for refunds.');
      wc.on('accountsChanged', next => setWallet(next?.[0] || ''));
      wc.on('chainChanged', chainId => { setQuote(null); const matching = origins.find(t => CHAIN_IDS[tokenChain(t)] === Number(chainId)); if (matching) { setOriginChain(tokenChain(matching)); setOriginAsset(''); } });
    } catch (error) {
      setWalletFeedback('WalletConnect failed: ' + (error?.message || 'Unknown error'));
      setNotice('WalletConnect failed: ' + (error?.message || 'Unknown error'));
    } finally { setWalletAction(''); }
  }

  function notifyPaymentSuccess() {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('XoDuspay payment complete', { body: 'NEAR Intents confirmed that the merchant payout was delivered.' });
    }
  }

  async function createQuote() {
    const requestId = ++quoteRequestRef.current;
    setQuote(null); setGasEstimate(null); setTxHash(''); setSwapStatus('');
    if (isNearToken(origin || {}) ? !nearWallet : !wallet) return setNotice(isNearToken(origin || {}) ? 'Connect your NEAR wallet first. It will be used for refunds.' : 'Connect your EVM wallet first. The connected address is used for refunds.');
    if (checkoutOnly && (!merchantNameParam || !merchantPurposeParam)) return setNotice('This checkout link is missing the required merchant name or payment purpose. Ask the merchant to regenerate the checkout link.');
    if (!origin || !destination || !amount || Number(amount) <= 0 || !recipient.trim()) return setNotice('Complete the origin token, destination token, amount, and merchant payout address.');
    if (recipient.startsWith('0x') && !isAddress(recipient)) return setNotice('The merchant EVM payout address is invalid.');
    if (!recipient.startsWith('0x') && !/^[a-z0-9._-]{2,64}$/i.test(recipient)) return setNotice('Enter a valid EVM address or NEAR account ID.');
    let atomicAmount;
    try { atomicAmount = fixedOutputCheckout ? usdToTokenAtomic(amount, destination) : parseUnits(amount, Number(origin.decimals)).toString(); }
    catch (error) { return setNotice(error.message || 'The amount could not be converted for the selected token.'); }

    setBusy(true);
    setNotice('Checking this payment route with a 1Click preview…');
    try {
      const response = await fetch('/api/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry: true,
          originAsset: origin.assetId,
          destinationAsset: destination.assetId,
          amount: atomicAmount,
          recipient: recipient.trim(),
          refundTo: isNearToken(origin) ? nearWallet : wallet,
          nearSenderAccount: isNearToken(origin) ? nearWallet : undefined,
          swapType: fixedOutputCheckout ? 'EXACT_OUTPUT' : 'EXACT_INPUT',
          slippageTolerance: 100
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Quote request failed.');
      if (requestId !== quoteRequestRef.current) return;
      let gas = { kind: 'unavailable', label: 'Wallet estimate unavailable' };
      if (isNearToken(origin)) {
        gas = { kind: 'near', label: 'Shown in NEAR wallet before approval' };
      } else if (!data?.quote?.depositAddress) {
        gas = { kind: 'unavailable', label: 'Final network fee will be shown in your wallet before approval' };
      } else {
        try {
          const walletProvider = activeEvmProviderRef.current || window.ethereum;
          if (!walletProvider) throw new Error('Connect an EVM wallet to estimate network gas.');
          const evmProvider = new BrowserProvider(walletProvider);
          const network = await evmProvider.getNetwork();
          const chainId = Number(network.chainId);
          if (chainId !== CHAIN_IDS[tokenChain(origin)]) throw new Error('Switch to the selected payment network to estimate gas.');
          const signer = await evmProvider.getSigner();
          const from = await signer.getAddress();
          const to = data.quote.depositAddress;
          const value = origin.contractAddress ? 0n : BigInt(data.quote.amountIn);
          const txRequest = origin.contractAddress
            ? { from, to: origin.contractAddress, data: ERC20_TRANSFER_INTERFACE.encodeFunctionData('transfer', [to, BigInt(data.quote.amountIn)]) }
            : { from, to, value };
          const gasLimit = await evmProvider.estimateGas(txRequest);
          const feeData = await evmProvider.getFeeData();
          const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
          if (!gasPrice) throw new Error('Network gas price is unavailable.');
          const gasCost = gasLimit * gasPrice;
          gas = { kind: 'evm', amount: formatUnits(gasCost, 18), symbol: NATIVE_SYMBOL[chainId] || 'native token', label: 'Estimated from current network conditions' };
        } catch (error) {
          gas = { kind: 'unavailable', label: error?.message || 'Wallet gas estimate unavailable' };
        }
      }
      setGasEstimate(gas);
      setQuote(data);
      setNotice('Quote ready. Review the payment amount and estimated network gas before approving.');
    } catch (e) {
      if (requestId === quoteRequestRef.current) {
        setQuote(null);
        setGasEstimate(null);
        setNotice(e.message || 'NEAR Intents could not quote this route. No alternate payment method will be used.');
      }
    }
    finally { if (requestId === quoteRequestRef.current) setBusy(false); }
  }

  useEffect(() => {
    const complete = Boolean(
      origin && destination && amount && Number(amount) > 0 &&
      recipient.trim() && (isNearToken(origin) ? nearWallet : wallet)
    );
    // Any changed checkout detail invalidates the old quote and requests a fresh one.
    quoteRequestRef.current += 1;
    setQuote(null);
    setGasEstimate(null);
    setTxHash('');
    setSwapStatus('');
    if (!complete) return undefined;

    const timer = setTimeout(() => { createQuote(); }, 650);
    return () => {
      clearTimeout(timer);
      quoteRequestRef.current += 1;
    };
  }, [configured, originAsset, destinationAsset, amount, recipient, wallet, nearWallet, tokens]);

  async function sendDeposit() {
    if (!quote?.quote || !origin) return;
    let activeQuote = quote;
    if (!activeQuote.quote.depositAddress) {
      setBusy(true);
      setNotice('The route preview is valid. Creating a fresh payment address…');
      try {
        const committed = await fetch('/api/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originAsset: origin.assetId,
            destinationAsset: destination.assetId,
            amount: fixedOutputCheckout ? usdToTokenAtomic(amount, destination) : parseUnits(amount, Number(origin.decimals)).toString(),
            recipient: recipient.trim(),
            refundTo: isNearToken(origin) ? nearWallet : wallet,
            nearSenderAccount: isNearToken(origin) ? nearWallet : undefined,
            swapType: fixedOutputCheckout ? 'EXACT_OUTPUT' : 'EXACT_INPUT',
            slippageTolerance: 100,
            dry: false
          })
        });
        const committedData = await committed.json();
        if (!committed.ok) throw new Error(committedData.error || 'Could not prepare the payment.');
        activeQuote = committedData;
        setQuote(committedData);
      } catch (error) {
        setBusy(false);
        setNotice(error.message || 'Could not prepare the payment.');
        return;
      }
    }
    if (Date.parse(activeQuote.quote.deadline) <= Date.now()) {
      setQuote(null); setBusy(false); return setNotice('This quote has expired. Request a new quote before sending funds.');
    }
    const chainKey = tokenChain(origin);
    if (chainKey === 'near') {
      if (!nearSelector || !nearWallet) return setNotice('Connect your NEAR wallet before sending this deposit.');
      setBusy(true);
      try {
        const walletClient = await nearSelector.wallet();
        const depositAddress = activeQuote.quote.depositAddress;
        const amountIn = String(activeQuote.quote.amountIn);
        const tokenContract = origin.contractAddress || (origin.assetId === 'nep141:wrap.near' ? 'wrap.near' : '');
        if (!tokenContract) throw new Error('This NEAR token has no valid NEP-141 contract address in the live registry.');
        setNotice('Confirm the NEAR deposit in your wallet. Check the token, amount, and deposit address carefully.');
        let transactions;
        if (tokenContract === 'wrap.near' || origin.symbol === 'NEAR') {
          transactions = [{ receiverId: 'wrap.near', actions: [
            actionCreators.functionCall('near_deposit', {}, 30000000000000n, BigInt(amountIn)),
            actionCreators.functionCall('ft_transfer', { receiver_id: depositAddress, amount: amountIn }, 50000000000000n, 1n)
          ] }];
        } else {
          transactions = [{ receiverId: tokenContract, actions: [actionCreators.functionCall(
            'ft_transfer', { receiver_id: depositAddress, amount: amountIn }, 50000000000000n, 1n
          )] }];
        }
        sessionStorage.setItem('intentpay_pending_near', JSON.stringify({ quote: activeQuote, originAsset, destinationAsset, recipient, nearWallet }));
        const result = await walletClient.signAndSendTransactions({ transactions, callbackUrl: window.location.href });
        const hash = result?.[0]?.transaction?.hash || result?.[0]?.transaction_outcome?.id || result?.transaction?.hash;
        if (!hash) {
          setTxHash('NEAR transaction submitted — hash unavailable');
          setNotice('Your NEAR wallet did not return a transaction hash. Refresh payment status before attempting anything again.');
          return;
        }
        sessionStorage.removeItem('intentpay_pending_near');
        setTxHash(hash);
        recordCurrentPayment('PROCESSING', hash, activeQuote);
        setNotice('NEAR transaction submitted. Notifying 1Click and checking settlement status…');
        const submitted = await fetch('/api/deposit/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash, depositAddress, depositMemo: activeQuote.quote.depositMemo || undefined, nearSenderAccount: nearWallet }) });
        const submitData = await submitted.json();
        if (!submitted.ok) throw new Error(submitData.error || 'Deposit notification failed. The NEAR transaction may already be confirmed; check status before retrying.');
        for (let attempt = 0; attempt < 180; attempt++) {
          const statusResponse = await fetch('/api/status?' + new URLSearchParams({ depositAddress, depositMemo: activeQuote.quote.depositMemo || '' }));
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error || 'Could not read payment status.');
          setSwapStatus(statusData.status || 'UNKNOWN');
          recordCurrentPayment(statusData.status || 'UNKNOWN', hash, activeQuote);
          if (TERMINAL.has(statusData.status)) {
            sessionStorage.removeItem('intentpay_pending_near');
            if (statusData.status === 'SUCCESS') notifyPaymentSuccess();
            setNotice(statusData.status === 'SUCCESS' ? 'Payment completed. 1Click reports that the merchant payout was delivered.' : `Payment ended with status: ${statusData.status}. Review the provider response before taking further action.`);
            return;
          }
          setNotice(`NEAR deposit submitted. Payment status: ${statusData.status || 'PROCESSING'}…`);
          await wait(5000);
        }
        setNotice('The NEAR deposit was submitted, but settlement is still pending. Check status again; do not send a second payment.');
      } catch (error) { setNotice(error.message || 'The NEAR deposit failed. Check your wallet activity before retrying.'); }
      finally { setBusy(false); }
      return;
    }
    const injectedProvider = activeEvmProviderRef.current || window.ethereum;
    if (!injectedProvider) return setNotice('Connect an EVM wallet before paying.');
    const expectedChain = CHAIN_IDS[chainKey];
    if (!expectedChain) return setNotice(`Wallet deposits from ${origin.blockchain} are not enabled in this EVM checkout yet.`);

    setBusy(true);
    try {
      let provider = new BrowserProvider(injectedProvider);
      let network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChain) {
        await provider.send('wallet_switchEthereumChain', [{ chainId: '0x' + expectedChain.toString(16) }]);
        provider = new BrowserProvider(injectedProvider);
        network = await provider.getNetwork();
      }
      if (Number(network.chainId) !== expectedChain) throw new Error('Your wallet is on the wrong network. Switch to the selected payment network.');
      const signer = await provider.getSigner();
      const depositAddress = activeQuote.quote.depositAddress;
      const atomicAmount = BigInt(activeQuote.quote.amountIn);
      setNotice('Confirm the deposit transaction in your wallet. Check the network and amount carefully.');

      let tx;
      if (origin.contractAddress) {
        const token = new Contract(origin.contractAddress, ERC20_ABI, signer);
        tx = await token.transfer(depositAddress, atomicAmount);
      } else {
        tx = await signer.sendTransaction({ to: depositAddress, value: atomicAmount });
      }
      setTxHash(tx.hash);
      recordCurrentPayment('PROCESSING', tx.hash, activeQuote);
      setNotice('Transaction broadcast. Waiting for one network confirmation…');
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('The deposit transaction did not confirm successfully.');

      setNotice('Deposit confirmed. Notifying 1Click and checking settlement status…');
      const submitted = await fetch('/api/deposit/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: tx.hash, depositAddress, depositMemo: activeQuote.quote.depositMemo || undefined })
      });
      const submitData = await submitted.json();
      if (!submitted.ok) throw new Error(submitData.error || 'Deposit notification failed. The chain transaction is confirmed; check status again.');

      for (let attempt = 0; attempt < 180; attempt++) {
        const url = '/api/status?' + new URLSearchParams({ depositAddress, depositMemo: activeQuote.quote.depositMemo || '' });
        const statusResponse = await fetch(url);
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error || 'Could not read payment status.');
        setSwapStatus(statusData.status || 'UNKNOWN');
        recordCurrentPayment(statusData.status || 'UNKNOWN', tx.hash, activeQuote);
        if (TERMINAL.has(statusData.status)) {
          if (statusData.status === 'SUCCESS') { notifyPaymentSuccess();
            setNotice('Payment completed. 1Click reports that the merchant payout was delivered.'); if ('Notification' in window && Notification.permission === 'granted') new Notification('XoDuspay payment complete', { body: 'The merchant payout has been confirmed by NEAR Intents.' }); }
          else setNotice(`Payment ended with status: ${statusData.status}. Review the provider response before taking further action.`);
          setBusy(false);
          return;
        }
        setNotice(`Deposit confirmed. Payment status: ${statusData.status || 'PROCESSING'}…`);
        await wait(5000);
      }
      setNotice('The deposit is confirmed, but settlement is still pending. You can check status again; do not send a second payment.');
    } catch (e) {
      setNotice(e.message || 'The payment step failed. If a transaction hash is shown, check its on-chain status before retrying.');
    } finally { setBusy(false); }
  }

  async function refreshStatus() {
    if (!quote?.quote?.depositAddress) return;
    setBusy(true);
    try {
      const response = await fetch('/api/status?' + new URLSearchParams({ depositAddress: quote.quote.depositAddress, depositMemo: quote.quote.depositMemo || '' }));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read status.');
      setSwapStatus(data.status || 'UNKNOWN');
      recordCurrentPayment(data.status || 'UNKNOWN');
      if (TERMINAL.has(data.status)) sessionStorage.removeItem('intentpay_pending_near');
      if (data.status === 'SUCCESS') notifyPaymentSuccess();
      setNotice(data.status === 'SUCCESS' ? 'Payment completed and delivered.' : `Current payment status: ${data.status || 'UNKNOWN'}`);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  if (merchantOnly) return <main className="shell merchant-page-shell">
    <header className="merchant-page-nav"><a className="brand" href="/"><span className="brand-mark">X</span> XoDuspay</a></header>
    <MerchantTools tokens={tokens} open page onClose={() => { window.location.href = '/'; }} />
  </main>;

  return <main className={checkoutOnly ? "shell customer-checkout-shell" : "shell"}>
    <nav className={checkoutOnly ? "nav customer-nav" : "nav"}><div className="site-menu-wrap" ref={siteMenuWrapRef}><button type="button" className="hamburger-btn" aria-label="Open navigation menu" aria-expanded={siteMenuOpen} onClick={() => setSiteMenuOpen(open => !open)}><span></span><span></span><span></span></button>{siteMenuOpen && <div className="site-menu"><button type="button" className="site-menu-primary" onClick={() => { setSiteMenuOpen(false); setMerchantWorkspaceOpen(true); }}><span><b>01</b> Merchant workspace</span><span>↗</span></button><a href="#how-it-works" onClick={() => setSiteMenuOpen(false)}>How it works</a><a href="#checkout" onClick={() => setSiteMenuOpen(false)}>Supported networks</a><a href="https://github.com/ExoDus768/Intent-pay#readme" target="_blank" rel="noreferrer" onClick={() => setSiteMenuOpen(false)}>Documentation <span>↗</span></a><a href="https://github.com/ExoDus768/Intent-pay" target="_blank" rel="noreferrer" onClick={() => setSiteMenuOpen(false)}>GitHub repository <span>↗</span></a><div className="follow-menu-wrap" ref={followMenuWrapRef}><button type="button" className="follow-menu-trigger" aria-expanded={followMenuOpen} aria-haspopup="true" onClick={() => setFollowMenuOpen(open => !open)}>Follow Us <span>{followMenuOpen ? '⌃' : '›'}</span></button>{followMenuOpen && <div className="follow-submenu"><div className="follow-submenu-title">Follow XoDuspay</div><a className="follow-link-placeholder" href="https://x.com/Intent_Payy" target="_blank" rel="noreferrer"><strong>Follow XoDuspay on X</strong><small>@Intent_Payy ↗</small></a></div>}</div></div>}</div><a className="brand" href="#"><span className="brand-mark">X</span> XoDuspay</a><div className="nav-right"><span className="status"><i />{health}</span><div className="wallet-menu-wrap" ref={walletMenuWrapRef}><button type="button" className="wallet-btn" onClick={() => setWalletMenuOpen(open => !open)} disabled={!!walletAction}>{walletAction === 'evm' ? 'Connecting EVM…' : walletAction === 'near' ? 'Opening NEAR…' : walletAction === 'walletconnect' ? 'Connecting…' : wallet || nearWallet ? short(wallet || nearWallet) : 'Connect Wallet'} <span aria-hidden="true">⌄</span></button>{walletMenuOpen && <div className="wallet-menu"><button type="button" onClick={() => { setWalletFeedback('Starting EVM connection…'); connectWallet(); }} disabled={walletAction === 'evm'}><strong>EVM Wallet</strong><small>MetaMask, Zerion and other EVM wallets</small>{wallet && <small>Connected: {short(wallet)}</small>}</button><button type="button" onClick={() => { setWalletFeedback('Starting NEAR connection…'); connectNearWallet(); }} disabled={walletAction === 'near'}><strong>NEAR Wallet</strong><small>MyNearWallet and supported NEAR wallets</small>{nearWallet && <small>Connected: {short(nearWallet)}</small>}</button><button type="button" onClick={connectMeteorWalletApp} disabled={walletAction === 'meteor-app'}><strong>Meteor Wallet App</strong><small>Connect directly inside Meteor’s in-app browser</small>{nearWallet && <small>Connected: {short(nearWallet)}</small>}</button><button type="button" onClick={() => { setWalletFeedback('Starting WalletConnect…'); connectWalletConnect(); }} disabled={walletAction === 'walletconnect'}><strong>WalletConnect</strong><small>Scan a QR code or open a compatible mobile wallet</small></button><div className="wallet-menu-feedback" role="status" aria-live="polite">{walletFeedback}</div></div>}</div></div></nav>
    {!checkoutOnly && <MerchantTools tokens={tokens} defaultRecipient={wallet || nearWallet} open={merchantWorkspaceOpen} onClose={() => setMerchantWorkspaceOpen(false)} />}
    {!checkoutOnly && <section className="hero" id="how-it-works"><div className="eyebrow">UNIVERSAL CHECKOUT · POWERED BY NEAR INTENTS</div><h1>One checkout.<br/><span>Crypto payments, simplified.</span></h1><p>Merchants configure one reusable checkout. Customers pay with a supported wallet and asset while the merchant receives their chosen payout token.</p></section>}
    <section className="checkout" id="checkout">{isWidgetCheckout && <div className="checkout-banner"><span className="eyebrow">{checkoutOnly ? 'MERCHANT PAYMENT' : 'PAYMENT REQUEST'}</span><strong>{isFixedWidgetCheckout ? "$" + Number(merchantAmountParam).toFixed(2) + " USD worth of " + (destination?.symbol || "payout token") : "Variable amount"}</strong><p>{checkoutParams.get("merchantName") || "Merchant payment"} · {fixedOutputCheckout ? "Fixed USD price. The equivalent " + (destination?.symbol || "payout token") + " amount is calculated using its live price." : "Customer chooses the amount."}</p></div>}
      <div className="checkout-head"><div><div className="eyebrow">MAINNET SECURE CHECKOUT</div><h2>{checkoutOnly ? 'Complete payment' : 'Configure payment'}</h2></div><span className="mainnet-pill">MAINNET</span></div>
      <form onSubmit={e => e.preventDefault()}>
        <label>Payment network</label>
        <select value={originChain} onChange={e => { setOriginChain(e.target.value); setOriginAsset(''); setOriginSearch(''); }} required disabled={loadingTokens}>
          <option value="">{loadingTokens ? 'Loading supported networks…' : 'Choose the network holding your token'}</option>
          {originChains.map(chain => <option key={chain} value={chain}>{chainLabel(chain)}</option>)}
        </select>
        <label>Customer pays with</label>
        <p className="helper-text">Choose your network first. XoDuspay checks your connected wallet and highlights tokens with a balance on that network.</p>
        <input
          type="search"
          value={originSearch}
          onChange={e => setOriginSearch(e.target.value)}
          placeholder="Search token (e.g. USDC)"
          aria-label="Search payment tokens"
          disabled={loadingTokens || !originChain}
        />
        <select value={originAsset} onChange={e => setOriginAsset(e.target.value)} required disabled={loadingTokens || !originChain}>
          <option value="">{!originChain ? 'Choose a network first' : walletTokenScan.loading ? 'Detecting wallet tokens…' : 'Choose a supported token'}</option>
          {walletDetectedOriginTokens.filter(t => !originSearch || (String(t.symbol || '') + ' ' + String(t.name || '')).toLowerCase().includes(originSearch.toLowerCase())).length > 0 && <optgroup label="Detected in your wallet">
            {walletDetectedOriginTokens.filter(t => tokenChain(t) === originChain && (!originSearch || (String(t.symbol || '') + ' ' + String(t.name || '')).toLowerCase().includes(originSearch.toLowerCase()))).map(t => (
              <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'} · {Number(walletTokenBalances[t.assetId]).toLocaleString(undefined, { maximumFractionDigits: 8 })} available</option>
            ))}
          </optgroup>}
          <optgroup label="Other supported tokens">
            {filteredOriginTokens.filter(t => tokenChain(t) === originChain && !(Number(walletTokenBalances[t.assetId] || 0) > 0)).map(t => (
              <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name && t.name !== t.symbol ? ' · ' + t.name : ''}</option>
            ))}
          </optgroup>
        </select>
        {originChain && walletTokenScan.loading && <p className="helper-text">Checking your wallet on {chainLabel(originChain)}…</p>}
        {originChain && walletTokenScan.error && <p className="warning">{walletTokenScan.error}</p>}
        {originChain && walletTokenScan.complete && <p className="helper-text">{walletDetectedOriginTokens.filter(t => tokenChain(t) === originChain).length} supported token(s) detected in your wallet on {chainLabel(originChain)}. You can still select another supported token if needed.</p>}
        {originSearch && filteredOriginTokens.filter(t => tokenChain(t) === originChain).length === 0 && <p className="warning">No supported token matches “{originSearch}” on this network.</p>}
        {origin && <p className="helper-text">Selected: <strong>{origin.symbol} on {chainLabel(tokenChain(origin))}</strong>{Number(origin.price) > 0 ? <> · 1 {origin.symbol} ≈ ${Number(origin.price).toLocaleString(undefined, { maximumFractionDigits: 6 })} USD</> : ' · Live USD price unavailable'}</p>}
        <label>{fixedOutputCheckout ? 'Fixed checkout price (USD)' : 'Amount to pay'}</label><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder={fixedOutputCheckout ? 'e.g. 25.00 USD' : '0.00'} required readOnly={Boolean(isFixedWidgetCheckout)} /><p className="helper-text">{fixedOutputCheckout ? <>This checkout is fixed at <strong>${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong>. XoDuspay converts that value into the merchant's payout token and quotes the amount you need to pay in your selected wallet token.</> : usdEstimate !== null ? <>Estimated value: <strong>~ ${usdEstimate.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })}</strong></> : amount && origin ? 'USD estimate unavailable for this token right now.' : 'Enter an amount to see its approximate USD value.'}</p><p className="helper-text">No XoDuspay minimum payment amount. Provider, token and network limits may still apply.</p>{origin && !fixedOutputCheckout && <><p className="balance-line">{balanceLoading ? 'Checking wallet balance…' : originBalance !== '' ? <>Wallet balance: <strong>{Number(originBalance).toLocaleString(undefined, { maximumFractionDigits: 8 })} {origin.symbol}</strong></> : balanceError}</p><div className="percentage-row" aria-label="Select percentage of wallet balance">{[25, 50, 75, 100].map(percent => <button key={percent} type="button" className="percentage-btn" disabled={balanceLoading || originBalance === ''} onClick={() => { try { const units = parseUnits(originBalance, Number(origin.decimals || 0)); setAmount(formatUnits(units * BigInt(percent) / 100n, Number(origin.decimals || 0))); } catch { setNotice('Could not calculate this percentage. Check the selected asset balance.'); } }}>{percent === 100 ? 'MAX' : percent + '%'}</button>)}</div></>}
        <div className="section-rule"><span>MERCHANT RECEIVES</span></div>
        <label>Choose payout network</label>
        <select value={destinationChain} onChange={e => { setDestinationChain(e.target.value); setDestinationAsset(''); }} required disabled={Boolean(isWidgetCheckout)}>
          <option value="">Select merchant payout network</option>
          {destinationChains.map(chain => <option key={chain} value={chain}>{chainLabel(chain)}</option>)}
        </select>
        <label>Choose payout token</label>
        <select value={destinationAsset} onChange={e => setDestinationAsset(e.target.value)} required disabled={Boolean(isWidgetCheckout) || !destinationChain || loadingTokens}>
          <option value="">{!destinationChain ? 'Choose a payout network first' : 'Select available payout token'}</option>
          {destinationTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name ? ' · ' + t.name : ''}</option>)}
        </select>
        {destinationChain && destinationTokens.length === 0 && <p className="warning">No payout tokens are currently listed for {chainLabel(destinationChain)} in the live NEAR Intents registry. Choose another network.</p>}
        {destinationChain && destinationTokens.length > 0 && !destinationTokens.some(t => String(t.symbol || '').toUpperCase() === 'USDT') && <p className="helper-text">USDT is not currently listed as a supported payout token on {chainLabel(destinationChain)} by NEAR Intents. Other listed tokens are shown above.</p>}
        <label>{destinationIsNear ? 'Merchant NEAR account address' : destinationIsSolana ? 'Merchant Solana wallet address' : 'Merchant EVM wallet address'}</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={recipientPlaceholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={Boolean(isWidgetCheckout) || !destinationChain || !destinationAsset} /><p className="helper-text">{!destinationChain ? 'Choose a payout network and token first. The required address format will appear here.' : !destinationAsset ? 'Choose a payout token to see the correct merchant address format.' : destinationIsNear ? 'Enter the merchant’s NEAR account ID, for example merchant.near' : destinationIsSolana ? 'Enter a Solana mainnet base58 wallet address.' : 'Enter the merchant’s EVM address for this network, starting with 0x'}</p>
        <div className="refund-note">Refund address: {isNearToken(origin || {}) ? (nearWallet ? short(nearWallet) : 'Connect NEAR wallet') : (wallet ? short(wallet) : 'Connect EVM wallet')}</div>
        <div className="quote-auto-state" role="status">{busy ? 'Getting your quote…' : quote ? 'Quote ready. Review it below.' : 'Your quote will be generated automatically when all selections are complete.'}</div>
      </form>
      {!configured && <p className="warning">NEAR Intents routing requires a server-side 1Click JWT. Same-chain, same-token EVM direct payments may still be available when the merchant accepts the selected token and network. Never paste API keys into this page.</p>}
      <p className="notice">{notice}</p>
      {quote?.quote && <div className="quote-card">
        <div className="quote-title">Mainnet quote details</div>{isWidgetCheckout && <><div className="quote-row"><span>Merchant</span><strong>{merchantNameParam}</strong></div><div className="quote-row"><span>Purpose of payment</span><strong>{merchantPurposeParam}</strong></div></>}{fixedOutputCheckout && <p className="helper-text">Fixed USD checkout · target price ${Number(amount).toFixed(2)} USD. {quote.provider === 'lifi' ? 'LI.FI calculates the input amount required to deliver this target value.' : 'NEAR Intents calculates the input amount required to deliver the merchant\'s selected payout token at this value.'}</p>}
        <div className="quote-row"><span>Pay</span><strong>{quote.quote.amountInFormatted || formatUnits(quote.quote.amountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>
        <div className="quote-row"><span>Estimated receive</span><strong>{(quote.quote.amountOutFormatted || quote.quote.amountOut) + ' ' + destination?.symbol}</strong></div>
        {quote.quote.amountInUsd && <div className="quote-row"><span>Payment value</span><strong>${Number(quote.quote.amountInUsd).toFixed(4)} USD</strong></div>}
        <div className="quote-row"><span>Network gas (paid separately)</span><strong>{gasEstimate?.kind === 'evm' ? '~' + Number(gasEstimate.amount).toPrecision(5) + ' ' + gasEstimate.symbol : gasEstimate?.label || 'Estimate unavailable'}</strong></div>
        {gasEstimate?.kind === 'evm' && <p className="helper-text">{gasEstimate.label}. The final fee can change before confirmation; your wallet shows the amount to approve.</p>}
        {gasEstimate?.kind === 'near' && <p className="helper-text">NEAR network gas is paid separately from your NEAR balance. Review the final fee in your NEAR wallet before approving.</p>}
        {gasEstimate?.kind === 'unavailable' && <p className="helper-text">Could not estimate gas: {gasEstimate.label}. Your wallet will show the required network fee before you sign.</p>}
        <div className="quote-row"><span>Routing</span><strong>NEAR Intents · 1Click</strong></div><div className="quote-row"><span>Merchant address</span><strong>{short(recipient)}</strong></div>
        <p className="helper-text">NEAR Intents calculates the conversion and delivery amount shown in this quote. Network gas is separate and paid to the source blockchain.</p>
        {quote.quote.minAmountIn && <div className="quote-row"><span>Minimum input</span><strong>{formatUnits(quote.quote.minAmountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>}
        {quote.quote.maxAmountIn && <div className="quote-row"><span>Maximum input</span><strong>{formatUnits(quote.quote.maxAmountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>}
        <div className="quote-row"><span>Estimated time</span><strong>{quote.quote.timeEstimate ? Math.ceil(quote.quote.timeEstimate / 60) + ' min' : 'Provider estimate unavailable'}</strong></div><div className="quote-row quote-countdown-row"><span>Quote expires in</span><strong className={quoteExpired ? 'quote-countdown expired' : 'quote-countdown'}>{quoteCountdownLabel}{quoteExpired ? ' · Expired' : quoteSecondsRemaining !== null ? ' remaining' : ''}</strong></div>
        {quote.quote.depositAddress ? <div className="deposit-address"><span>Unique deposit address</span><code>{quote.quote.depositAddress}</code></div> : <p className="helper-text">{quote.directEvm ? 'Funds go directly to the merchant EVM address shown above.' : quote.provider === 'lifi' ? 'LI.FI provides a wallet transaction for the selected EVM route.' : 'Payment address is created securely when you tap Confirm Pay.'}</p>}
        {quote.quote.depositMemo && <div className="deposit-address"><span>Required memo</span><code>{quote.quote.depositMemo}</code></div>}
        {txHash && <div className="tx-details"><span>Deposit transaction</span><code>{short(txHash)}</code><span>Status: {paymentStatus || 'Waiting'}</span></div>}
        {txHash && <button className="secondary" onClick={refreshStatus} disabled={busy}>Refresh payment status</button>}
        <p className="fineprint">MAINNET TRANSACTION · This approval transfers real assets. Verify the wallet network, token, amount, merchant address, quote expiry, and deposit address before signing. Never send a different asset to this address.</p>
      </div>}
      {quote?.quote && <>{quoteExpired && <p className="warning" role="alert">This quote has expired. Request a fresh quote before making payment.</p>}<button type="button" className="primary" onClick={quoteExpired ? createQuote : sendDeposit} disabled={busy || Boolean(txHash)}>
        {busy ? 'Processing payment…' : txHash ? 'Payment submitted' : quoteExpired ? 'Refresh quote' : 'Confirm Pay'}
      </button></>}
    </section>
    {checkoutOnly && <section className="customer-history">
      <div className="customer-history-head"><div><div className="eyebrow">YOUR ACTIVITY</div><h2>Transaction history</h2><p>Payments made by this wallet. Sign with the wallet to sync across devices.</p></div><span className="history-count">{customerHistory.length} {customerHistory.length === 1 ? 'payment' : 'payments'}</span></div>
      {!customerAccount ? <p className="history-empty">Connect the wallet you used to pay to view its transaction history.</p> : <><button type="button" className="secondary" onClick={() => setHistorySyncRequested(true)} disabled={historyAuth.status === 'signing'}>{historyAuth.status === 'signing' ? 'Verifying wallet…' : historyAuth.status === 'ready' ? 'History synced' : 'Sign once to sync across devices'}</button>{historyAuth.status === 'error' && <p className="history-empty">History sync needs verification: {historyAuth.error}</p>}{customerHistory.length === 0 ? <p className="history-empty">No payments recorded for this wallet yet.</p> : <div className="history-list">{customerHistory.map(item => <article className="history-item" key={item.id}>
        <div className="history-item-top"><strong>{item.merchant || 'Merchant payment'}</strong><span className={'history-status status-' + String(item.status || 'processing').toLowerCase()}>{String(item.status || 'PROCESSING').replaceAll('_', ' ')}</span></div>
        {item.purpose && <div className="history-route"><strong>Purpose:</strong> {item.purpose}</div>}
        <div className="history-amount">{item.amountPaid || '—'} {item.sourceToken || ''}<span>→</span>{item.amountReceived || '—'} {item.destinationToken || ''}</div>
        <div className="history-route">{item.sourceNetwork || 'Source'} → {item.destinationNetwork || 'Destination'}</div>
        {item.transactionHash && <div className="history-hash">Transaction: <code>{short(item.transactionHash)}</code></div>}
        <div className="history-date">{new Date(item.createdAt || item.updatedAt || Date.now()).toLocaleString()}</div>
      </article>)}</div>}</>}
      <p className="history-disclaimer">Your history is tied to your wallet and stored in private cloud storage. Connect the same wallet and sign the verification message on another device to see the same records.</p>
    </section>}
    <footer><span>XoDuspay</span><span>{checkoutOnly ? 'Secure checkout powered by NEAR Intents' : 'Universal crypto checkout powered by NEAR Intents'}</span></footer>
  </main>;
}
