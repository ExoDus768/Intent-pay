import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, Contract, Interface, formatUnits, isAddress, parseUnits } from 'ethers';
import { actionCreators, setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import '@near-wallet-selector/modal-ui/styles.css';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import MerchantTools from './MerchantTools.jsx';
import SocialPayPage from './SocialPay.jsx';

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
const tokenChain = t => String(t.blockchain || '').toLowerCase();
const isNearToken = t => tokenChain(t) === 'near';
const tokenId = t => t.assetId || '';
const tokenName = t => `${t.symbol || 'TOKEN'} · ${t.blockchain || 'Unknown chain'}`;
const chainLabel = value => ({eth:'Ethereum',arb:'Arbitrum',op:'Optimism',avax:'Avalanche',bera:'Berachain'}[value] || String(value || '').split(/[-_ ]+/).map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' '));
const TOKEN_PRIORITY = ['USDC','USDT','ETH','NEAR','DAI','WETH','WBTC','USDBC','USDE','FRAX','USDS'];
const tokenPriority = t => { const i = TOKEN_PRIORITY.indexOf(String(t.symbol || '').toUpperCase()); return i < 0 ? TOKEN_PRIORITY.length : i; };
const short = (value = '') => value.length > 24 ? value.slice(0, 10) + '…' + value.slice(-8) : value;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));



export default function App() {
  const path = window.location.pathname;
  const hasInvoice = new URLSearchParams(window.location.search).has('invoice');
  if (path.startsWith('/social-pay')) return <SocialPayPage />;
  return <MerchantApp />;
}

function MerchantApp() {
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
  const [invoice, setInvoice] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(Boolean(new URLSearchParams(window.location.search).get('invoice')));
  const [originChain, setOriginChain] = useState('');
  const [originAsset, setOriginAsset] = useState('');
  const [destinationChain, setDestinationChain] = useState('');
  const [destinationAsset, setDestinationAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [originBalance, setOriginBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quote, setQuote] = useState(null);
  const [gasEstimate, setGasEstimate] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [swapStatus, setSwapStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Connect your EVM or NEAR mainnet wallet, choose the asset you will pay with, and set the merchant payout details.');
  const quoteRequestRef = useRef(0);
  const evmProvidersRef = useRef([]);
  const activeEvmProviderRef = useRef(null);
  const walletConnectProviderRef = useRef(null);
  const siteMenuWrapRef = useRef(null);
  const walletMenuWrapRef = useRef(null);

  // Dismiss open menus when the user taps outside them or presses Escape.
  useEffect(() => {
    if (!siteMenuOpen && !walletMenuOpen) return undefined;
    const handlePointerDown = event => {
      if (siteMenuOpen && !siteMenuWrapRef.current?.contains(event.target)) { setSiteMenuOpen(false); setFollowMenuOpen(false); }
      if (walletMenuOpen && !walletMenuWrapRef.current?.contains(event.target)) setWalletMenuOpen(false);
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
  }, [siteMenuOpen, walletMenuOpen]);

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
        const selector = await setupWalletSelector({ network: 'mainnet', modules: [setupMyNearWallet()] });
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
      const list = Array.isArray(data) ? data : (data.tokens || data.data || []);
      setTokens(list.filter(t => t.assetId && Number.isInteger(Number(t.decimals))));
    }).catch(e => setNotice(e.message)).finally(() => setLoadingTokens(false));
    return () => { active = false; };
  }, []);

  const origin = useMemo(() => tokens.find(t => tokenId(t) === originAsset), [tokens, originAsset]);
  const destination = useMemo(() => tokens.find(t => tokenId(t) === destinationAsset), [tokens, destinationAsset]);
  const estimateToken = invoice ? destination : origin;
  const usdEstimate = amount && Number.isFinite(Number(amount)) && Number(amount) > 0 && Number.isFinite(Number(estimateToken?.price)) && Number(estimateToken?.price) > 0
    ? Number(amount) * Number(estimateToken.price)
    : null;
  const invoiceId = useMemo(() => new URLSearchParams(window.location.search).get('invoice') || '', []);
  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/invoices/' + encodeURIComponent(invoiceId));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'This payment link could not be loaded.');
        if (cancelled) return;
        setInvoice(data);
        setDestinationChain(String(data.destinationChain || '').toLowerCase());
        setDestinationAsset(data.destinationAsset);
        setRecipient(data.recipient);
        setAmount(data.amount);
        setNotice('Invoice loaded. Choose the asset you want to pay with. The merchant will receive the exact invoice amount through NEAR Intents.');
      } catch (error) {
        if (!cancelled) setNotice(error.message || 'Could not load invoice.');
      } finally { if (!cancelled) setInvoiceLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [invoiceId]);
  const origins = useMemo(() => tokens.filter(t => CHAIN_IDS[tokenChain(t)] || (isNearToken(t) && (t.contractAddress || t.assetId === 'nep141:wrap.near'))), [tokens]);
  const originChains = useMemo(() => [...new Set(origins.map(tokenChain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [origins]);
  const originTokens = useMemo(() => origins.filter(t => tokenChain(t) === originChain).sort((a, b) => tokenPriority(a) - tokenPriority(b) || String(a.symbol || '').localeCompare(String(b.symbol || ''))), [origins, originChain]);
  const destinations = useMemo(() => tokens, [tokens]);
  const destinationChains = useMemo(() => [...new Set(destinations.map(tokenChain))].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b))), [destinations]);
  const destinationTokens = useMemo(() => destinations.filter(t => tokenChain(t) === destinationChain).sort((a, b) => tokenPriority(a) - tokenPriority(b) || String(a.symbol || '').localeCompare(String(b.symbol || ''))), [destinations, destinationChain]);
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
          if (!providerObject) throw new Error('Open IntentPay inside your EVM wallet browser to read the balance.');
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
  const recipientPlaceholder = destinationIsNear ? 'e.g. merchant.near' : 'e.g. 0xAbC123...7890';

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
        throw new Error('No EVM wallet was detected in this browser. Open IntentPay inside a wallet app or use WalletConnect.');
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
          selected.on?.('chainChanged', () => setQuote(null));
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
            name: 'IntentPay',
            description: 'Cross-chain checkout powered by NEAR Intents',
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
      wc.on('chainChanged', () => setQuote(null));
    } catch (error) {
      setWalletFeedback('WalletConnect failed: ' + (error?.message || 'Unknown error'));
      setNotice('WalletConnect failed: ' + (error?.message || 'Unknown error'));
    } finally { setWalletAction(''); }
  }

  function notifyPaymentSuccess() {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('IntentPay payment complete', { body: 'NEAR Intents confirmed that the merchant payout was delivered.' });
    }
  }

  async function createQuote() {
    const requestId = ++quoteRequestRef.current;
    setQuote(null); setGasEstimate(null); setTxHash(''); setSwapStatus('');
    if (isNearToken(origin || {}) ? !nearWallet : !wallet) return setNotice(isNearToken(origin || {}) ? 'Connect your NEAR wallet first. It will be used for refunds.' : 'Connect your EVM wallet first. The connected address is used for refunds.');
    if (!origin || !destination || !amount || Number(amount) <= 0 || !recipient.trim()) return setNotice('Complete the origin token, destination token, amount, and merchant payout address.');
    if (invoice && (destination.assetId !== invoice.destinationAsset || recipient.toLowerCase() !== invoice.recipient.toLowerCase())) return setNotice('The invoice payout details cannot be changed.');
    if (recipient.startsWith('0x') && !isAddress(recipient)) return setNotice('The merchant EVM payout address is invalid.');
    if (!recipient.startsWith('0x') && !/^[a-z0-9._-]{2,64}$/i.test(recipient)) return setNotice('Enter a valid EVM address or NEAR account ID.');
    let atomicAmount;
    try { atomicAmount = parseUnits(amount, Number(invoice ? destination.decimals : origin.decimals)).toString(); }
    catch { return setNotice('The amount has too many decimal places for the selected token.'); }

    setBusy(true);
    setNotice('Requesting a committed 1Click quote…');
    try {
      const response = await fetch('/api/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originAsset: origin.assetId,
          destinationAsset: destination.assetId,
          amount: atomicAmount,
          recipient: recipient.trim(),
          refundTo: isNearToken(origin) ? nearWallet : wallet,
          nearSenderAccount: isNearToken(origin) ? nearWallet : undefined,
          swapType: invoice ? 'EXACT_OUTPUT' : 'EXACT_INPUT',
          invoiceId: invoice?.id,
          slippageTolerance: 100
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Quote request failed.');
      if (requestId !== quoteRequestRef.current) return;
      let gas = { kind: 'unavailable', label: 'Wallet estimate unavailable' };
      if (isNearToken(origin)) {
        gas = { kind: 'near', label: 'Shown in NEAR wallet before approval' };
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
      if (requestId === quoteRequestRef.current) setNotice(e.message || 'Could not create quote.');
    }
    finally { if (requestId === quoteRequestRef.current) setBusy(false); }
  }

  useEffect(() => {
    const complete = Boolean(
      configured && !invoiceLoading && origin && destination && amount && Number(amount) > 0 &&
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
  }, [configured, invoiceLoading, invoice?.id, originAsset, destinationAsset, amount, recipient, wallet, nearWallet, tokens]);

  async function sendDeposit() {
    if (!quote?.quote?.depositAddress || !origin) return;
    if (Date.parse(quote.quote.deadline) <= Date.now()) {
      setQuote(null); return setNotice('This quote has expired. Request a new quote before sending funds.');
    }
    const chainKey = tokenChain(origin);
    if (chainKey === 'near') {
      if (!nearSelector || !nearWallet) return setNotice('Connect your NEAR wallet before sending this deposit.');
      setBusy(true);
      try {
        const walletClient = await nearSelector.wallet();
        const depositAddress = quote.quote.depositAddress;
        const amountIn = String(quote.quote.amountIn);
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
        sessionStorage.setItem('intentpay_pending_near', JSON.stringify({ quote, originAsset, destinationAsset, recipient, nearWallet }));
        const result = await walletClient.signAndSendTransactions({ transactions, callbackUrl: window.location.href });
        const hash = result?.[0]?.transaction?.hash || result?.[0]?.transaction_outcome?.id || result?.transaction?.hash;
        if (!hash) {
          setTxHash('NEAR transaction submitted — hash unavailable');
          setNotice('Your NEAR wallet did not return a transaction hash. Refresh payment status before attempting anything again.');
          return;
        }
        sessionStorage.removeItem('intentpay_pending_near');
        setTxHash(hash);
        setNotice('NEAR transaction submitted. Notifying 1Click and checking settlement status…');
        const submitted = await fetch('/api/deposit/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash, depositAddress, nearSenderAccount: nearWallet }) });
        const submitData = await submitted.json();
        if (!submitted.ok) throw new Error(submitData.error || 'Deposit notification failed. The NEAR transaction may already be confirmed; check status before retrying.');
        for (let attempt = 0; attempt < 180; attempt++) {
          const statusResponse = await fetch('/api/status?' + new URLSearchParams({ depositAddress }));
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error || 'Could not read payment status.');
          setSwapStatus(statusData.status || 'UNKNOWN');
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
        provider = new BrowserProvider(window.ethereum);
        network = await provider.getNetwork();
      }
      if (Number(network.chainId) !== expectedChain) throw new Error('Your wallet is on the wrong network. Switch to the selected payment network.');
      const signer = await provider.getSigner();
      const depositAddress = quote.quote.depositAddress;
      const atomicAmount = BigInt(quote.quote.amountIn);
      setNotice('Confirm the deposit transaction in your wallet. Check the network and amount carefully.');

      let tx;
      if (origin.contractAddress) {
        const token = new Contract(origin.contractAddress, ERC20_ABI, signer);
        tx = await token.transfer(depositAddress, atomicAmount);
      } else {
        tx = await signer.sendTransaction({ to: depositAddress, value: atomicAmount });
      }
      setTxHash(tx.hash);
      setNotice('Transaction broadcast. Waiting for one network confirmation…');
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error('The deposit transaction did not confirm successfully.');

      setNotice('Deposit confirmed. Notifying 1Click and checking settlement status…');
      const submitted = await fetch('/api/deposit/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: tx.hash, depositAddress })
      });
      const submitData = await submitted.json();
      if (!submitted.ok) throw new Error(submitData.error || 'Deposit notification failed. The chain transaction is confirmed; check status again.');

      for (let attempt = 0; attempt < 180; attempt++) {
        const url = '/api/status?' + new URLSearchParams({ depositAddress });
        const statusResponse = await fetch(url);
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error || 'Could not read payment status.');
        setSwapStatus(statusData.status || 'UNKNOWN');
        if (TERMINAL.has(statusData.status)) {
          if (statusData.status === 'SUCCESS') { notifyPaymentSuccess();
            setNotice('Payment completed. 1Click reports that the merchant payout was delivered.'); if ('Notification' in window && Notification.permission === 'granted') new Notification('IntentPay payment complete', { body: 'The merchant payout has been confirmed by NEAR Intents.' }); }
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
      const response = await fetch('/api/status?' + new URLSearchParams({ depositAddress: quote.quote.depositAddress }));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read status.');
      setSwapStatus(data.status || 'UNKNOWN');
      if (TERMINAL.has(data.status)) sessionStorage.removeItem('intentpay_pending_near');
      if (data.status === 'SUCCESS') notifyPaymentSuccess();
      setNotice(data.status === 'SUCCESS' ? 'Payment completed and delivered.' : `Current payment status: ${data.status || 'UNKNOWN'}`);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <nav className="nav"><div className="site-menu-wrap" ref={siteMenuWrapRef}><button type="button" className="hamburger-btn" aria-label="Open navigation menu" aria-expanded={siteMenuOpen} onClick={() => setSiteMenuOpen(open => !open)}><span></span><span></span><span></span></button>{siteMenuOpen && <div className="site-menu"><a href="#how-it-works" onClick={() => setSiteMenuOpen(false)}>Cross-chain payment <span>↗</span></a><a href="#how-it-works" onClick={() => setSiteMenuOpen(false)}>How it works</a><a href="#checkout" onClick={() => setSiteMenuOpen(false)}>Supported networks</a><a href="/social-pay" onClick={() => setSiteMenuOpen(false)}>Social Pay <span>↗</span></a><a href="https://github.com/ExoDus768/Intent-pay#readme" target="_blank" rel="noreferrer" onClick={() => setSiteMenuOpen(false)}>Documentation <span>↗</span></a><a href="https://github.com/ExoDus768/Intent-pay" target="_blank" rel="noreferrer" onClick={() => setSiteMenuOpen(false)}>GitHub repository <span>↗</span></a><div className="follow-menu-wrap"><button type="button" className="follow-menu-trigger" aria-expanded={followMenuOpen} aria-haspopup="true" onClick={() => setFollowMenuOpen(open => !open)}>Follow Us <span>{followMenuOpen ? '⌃' : '›'}</span></button>{followMenuOpen && <div className="follow-submenu"><div className="follow-submenu-title">Follow IntentPay</div><a className="follow-link-placeholder" href="https://x.com/Intent_Payy" target="_blank" rel="noreferrer"><strong>Follow IntentPay on X</strong><small>@Intent_Payy ↗</small></a></div>}</div></div>}</div><a className="brand" href="#"><span className="brand-mark">I</span> IntentPay</a><div className="nav-right"><span className="status"><i />{health}</span><MerchantTools tokens={tokens} defaultRecipient={wallet || nearWallet} /><div className="wallet-menu-wrap" ref={walletMenuWrapRef}><button type="button" className="wallet-btn" onClick={() => setWalletMenuOpen(open => !open)} disabled={!!walletAction}>{walletAction === 'evm' ? 'Connecting EVM…' : walletAction === 'near' ? 'Opening NEAR…' : walletAction === 'walletconnect' ? 'Connecting…' : wallet || nearWallet ? short(wallet || nearWallet) : 'Connect Wallet'} <span aria-hidden="true">⌄</span></button>{walletMenuOpen && <div className="wallet-menu"><button type="button" onClick={() => { setWalletFeedback('Starting EVM connection…'); connectWallet(); }} disabled={walletAction === 'evm'}><strong>EVM Wallet</strong><small>MetaMask, Zerion and other EVM wallets</small>{wallet && <small>Connected: {short(wallet)}</small>}</button><button type="button" onClick={() => { setWalletFeedback('Starting NEAR connection…'); connectNearWallet(); }} disabled={walletAction === 'near'}><strong>NEAR Wallet</strong><small>MyNearWallet and supported NEAR wallets</small>{nearWallet && <small>Connected: {short(nearWallet)}</small>}</button><button type="button" onClick={() => { setWalletFeedback('Starting WalletConnect…'); connectWalletConnect(); }} disabled={walletAction === 'walletconnect'}><strong>WalletConnect</strong><small>Scan a QR code or open a compatible mobile wallet</small></button><div className="wallet-menu-feedback" role="status" aria-live="polite">{walletFeedback}</div></div>}</div></div></nav>
    <section className="hero" id="how-it-works"><div className="eyebrow">CROSS-CHAIN CHECKOUT · POWERED BY NEAR INTENTS</div><h1>One checkout.<br/><span>Any supported chain.</span></h1><p>Customers pay from a supported network. Merchants receive their selected asset at their payout address.</p></section>
    <section className="checkout" id="checkout">{invoice && <div className="invoice-banner"><span className="eyebrow">PAYMENT INVOICE</span><strong>{invoice.amount} {invoice.symbol}</strong><p>{invoice.description || 'Merchant payment'} · Exact amount delivered to the merchant through NEAR Intents.</p></div>}{invoiceLoading && <p className="notice">Loading invoice details…</p>}
      <div className="checkout-head"><div><div className="eyebrow">MAINNET MERCHANT CHECKOUT</div><h2>Configure payment</h2></div><span className="mainnet-pill">MAINNET</span></div>
      <form onSubmit={e => e.preventDefault()}>
        <label>Customer pays with</label>
        <label>Choose network</label>
        <select value={originChain} onChange={e => { setOriginChain(e.target.value); setOriginAsset(''); }} required>
          <option value="">Select payment network</option>
          {originChains.map(chain => <option key={chain} value={chain}>{chainLabel(chain)}</option>)}
        </select>
        <label>Choose token</label>
        <select value={originAsset} onChange={e => setOriginAsset(e.target.value)} required disabled={!originChain || loadingTokens}>
          <option value="">{!originChain ? 'Choose a network first' : 'Select available token'}</option>
          {originTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name ? ' · ' + t.name : ''}</option>)}
        </select>
        <label>{invoice ? 'Merchant receives exactly' : 'Amount to pay'}</label><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required readOnly={Boolean(invoice)} /><p className="helper-text">{usdEstimate !== null ? <>Estimated value: <strong>~ ${usdEstimate.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })}</strong></> : amount && estimateToken ? 'USD estimate unavailable for this token right now.' : 'Enter an amount to see its approximate USD value.'}</p><p className="helper-text">Minimum swap: $0.01 USD equivalent, checked using live 1Click pricing.</p>{origin && !invoice && <><p className="balance-line">{balanceLoading ? 'Checking wallet balance…' : originBalance !== '' ? <>Wallet balance: <strong>{Number(originBalance).toLocaleString(undefined, { maximumFractionDigits: 8 })} {origin.symbol}</strong></> : balanceError}</p><div className="percentage-row" aria-label="Select percentage of wallet balance">{[25, 50, 75, 100].map(percent => <button key={percent} type="button" className="percentage-btn" disabled={balanceLoading || originBalance === ''} onClick={() => { try { const units = parseUnits(originBalance, Number(origin.decimals || 0)); setAmount(formatUnits(units * BigInt(percent) / 100n, Number(origin.decimals || 0))); } catch { setNotice('Could not calculate this percentage. Check the selected asset balance.'); } }}>{percent === 100 ? 'MAX' : percent + '%'}</button>)}</div></>}
        <div className="section-rule"><span>MERCHANT RECEIVES</span></div>
        <label>Choose payout network</label>
        <select value={destinationChain} onChange={e => { setDestinationChain(e.target.value); setDestinationAsset(''); }} required disabled={Boolean(invoice)}>
          <option value="">Select merchant payout network</option>
          {destinationChains.map(chain => <option key={chain} value={chain}>{chainLabel(chain)}</option>)}
        </select>
        <label>Choose payout token</label>
        <select value={destinationAsset} onChange={e => setDestinationAsset(e.target.value)} required disabled={Boolean(invoice) || !destinationChain || loadingTokens}>
          <option value="">{!destinationChain ? 'Choose a payout network first' : 'Select available payout token'}</option>
          {destinationTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name ? ' · ' + t.name : ''}</option>)}
        </select>
        {destinationChain && destinationTokens.length === 0 && <p className="warning">No payout tokens are currently listed for {chainLabel(destinationChain)} in the live NEAR Intents registry. Choose another network.</p>}
        {destinationChain && destinationTokens.length > 0 && !destinationTokens.some(t => String(t.symbol || '').toUpperCase() === 'USDT') && <p className="helper-text">USDT is not currently listed as a supported payout token on {chainLabel(destinationChain)} by NEAR Intents. Other listed tokens are shown above.</p>}
        <label>{destinationIsNear ? 'Merchant NEAR account address' : 'Merchant EVM wallet address'}</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={recipientPlaceholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={Boolean(invoice) || !destinationChain || !destinationAsset} /><p className="helper-text">{!destinationChain ? 'Choose a payout network and token first. The required address format will appear here.' : !destinationAsset ? 'Choose a payout token to see the correct merchant address format.' : destinationIsNear ? 'Enter the merchant’s NEAR account ID, for example merchant.near' : 'Enter the merchant’s EVM address for this network, starting with 0x'}</p>
        <div className="refund-note">Refund address: {isNearToken(origin || {}) ? (nearWallet ? short(nearWallet) : 'Connect NEAR wallet') : (wallet ? short(wallet) : 'Connect EVM wallet')}</div>
        <div className="quote-auto-state" role="status">{busy ? 'Getting your quote…' : quote ? 'Quote ready. Review it below.' : 'Your quote will be generated automatically when all selections are complete.'}</div>
      </form>
      {!configured && <p className="warning">Mainnet payments are locked until the server has a valid 1Click JWT. Add it as a Vercel server environment variable. Never paste it into this page.</p>}
      <p className="notice">{notice}</p>
      {quote?.quote && <div className="quote-card">
        <div className="quote-title">Mainnet quote details</div>{invoice && <p className="helper-text">Fixed-output invoice · NEAR Intents calculates the input amount required to deliver the exact merchant amount.</p>}
        <div className="quote-row"><span>Pay</span><strong>{quote.quote.amountInFormatted || formatUnits(quote.quote.amountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>
        <div className="quote-row"><span>Estimated receive</span><strong>{(quote.quote.amountOutFormatted || quote.quote.amountOut) + ' ' + destination?.symbol}</strong></div>
        {quote.quote.amountInUsd && <div className="quote-row"><span>Payment value</span><strong>${Number(quote.quote.amountInUsd).toFixed(4)} USD</strong></div>}
        <div className="quote-row"><span>Network gas (paid separately)</span><strong>{gasEstimate?.kind === 'evm' ? '~' + Number(gasEstimate.amount).toPrecision(5) + ' ' + gasEstimate.symbol : gasEstimate?.label || 'Estimate unavailable'}</strong></div>
        {gasEstimate?.kind === 'evm' && <p className="helper-text">{gasEstimate.label}. The final fee can change before confirmation; your wallet shows the amount to approve.</p>}
        {gasEstimate?.kind === 'near' && <p className="helper-text">NEAR network gas is paid separately from your NEAR balance. Review the final fee in your NEAR wallet before approving.</p>}
        {gasEstimate?.kind === 'unavailable' && <p className="helper-text">Could not estimate gas: {gasEstimate.label}. Your wallet will show the required network fee before you sign.</p>}
        <div className="quote-row"><span>Routing</span><strong>NEAR Intents · 1Click</strong></div><div className="quote-row"><span>Merchant address</span><strong>{short(recipient)}</strong></div>
        <p className="helper-text">1Click routing and swap costs are reflected in the quoted receive amount where applicable. Network gas is separate and paid to the source blockchain.</p>
        {quote.quote.minAmountIn && <div className="quote-row"><span>Minimum input</span><strong>{formatUnits(quote.quote.minAmountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>}
        {quote.quote.maxAmountIn && <div className="quote-row"><span>Maximum input</span><strong>{formatUnits(quote.quote.maxAmountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>}
        <div className="quote-row"><span>Estimated time</span><strong>{quote.quote.timeEstimate ? Math.ceil(quote.quote.timeEstimate / 60) + ' min' : 'Provider estimate unavailable'}</strong></div><div className="quote-row"><span>Quote expires</span><strong>{quote.quote.deadline ? new Date(quote.quote.deadline).toLocaleTimeString() : 'Provider-defined'}</strong></div>
        {<div className="deposit-address"><span>Unique deposit address</span><code>{quote.quote.depositAddress}</code></div>}
        {quote.quote.depositMemo && <div className="deposit-address"><span>Required memo</span><code>{quote.quote.depositMemo}</code></div>}
        {txHash && <div className="tx-details"><span>Deposit transaction</span><code>{short(txHash)}</code><span>Status: {swapStatus || 'Waiting'}</span></div>}
        {txHash && <button className="secondary" onClick={refreshStatus} disabled={busy}>Refresh payment status</button>}
        <p className="fineprint">MAINNET TRANSACTION · This approval transfers real assets. Verify the wallet network, token, amount, merchant address, quote expiry, and deposit address before signing. Never send a different asset to this address.</p>
      </div>}
      {quote?.quote && <button type="button" className="primary" onClick={sendDeposit} disabled={busy || Boolean(txHash)}>
        {busy ? 'Processing payment…' : txHash ? 'Payment submitted' : 'Confirm Pay'}
      </button>}
    </section>
    <footer><span>IntentPay</span><span>Non-custodial cross-chain checkout</span></footer>
  </main>;
}
