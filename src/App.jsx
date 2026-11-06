import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, Contract, formatUnits, isAddress, parseUnits } from 'ethers';
import { actionCreators, setupWalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import '@near-wallet-selector/modal-ui/styles.css';

const CHAIN_IDS = {
  eth: 1, ethereum: 1, base: 8453, arb: 42161, arbitrum: 42161,
  op: 10, optimism: 10, polygon: 137, bsc: 56, avax: 43114,
  avalanche: 43114, gnosis: 100, bera: 80094, berachain: 80094,
  scroll: 534352, aurora: 1313161554
};
const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address owner) view returns (uint256)'];
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
  const [health, setHealth] = useState('Checking service…');
  const [configured, setConfigured] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [wallet, setWallet] = useState('');
  const [nearWallet, setNearWallet] = useState('');
  const [nearSelector, setNearSelector] = useState(null);
  const [nearModal, setNearModal] = useState(null);
  const [walletAction, setWalletAction] = useState('');
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
  const [txHash, setTxHash] = useState('');
  const [swapStatus, setSwapStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Connect your EVM or NEAR mainnet wallet, choose the asset you will pay with, and set the merchant payout details.');
  const quoteRequestRef = useRef(0);
  const evmProvidersRef = useRef([]);
  const activeEvmProviderRef = useRef(null);

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
    try {
      if (!nearSelector || !nearModal) {
        setNotice('NEAR wallet options are still initializing. Wait a moment and tap Connect NEAR again.');
        return;
      }
      nearModal.show();
      setNotice('Choose a NEAR wallet in the wallet window to connect your mainnet account.');
    } catch (error) {
      setNotice('Could not open the NEAR wallet window: ' + (error?.message || 'Unknown error') + '. Try refreshing the page.');
    } finally { setWalletAction(''); }
  }

  async function connectWallet() {
    setWalletAction('evm');
    try {
      // Ask injected wallets to announce through EIP-6963 (Zerion supports this standard).
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      await new Promise(resolve => setTimeout(resolve, 250));
      const announced = evmProvidersRef.current;
      const zerion = announced.find(item => /zerion/i.test((item.info?.name || '') + ' ' + (item.info?.rdns || '')));
      const selected = zerion?.provider || announced[0]?.provider || window.ethereum;
      if (!selected) {
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        throw new Error(mobile ? 'No injected EVM provider was detected. Open this page in Zerion’s in-app browser and allow the wallet connection request.' : 'No injected EVM wallet was detected.');
      }
      activeEvmProviderRef.current = selected;
      const provider = new BrowserProvider(selected);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts?.length) throw new Error('The wallet did not return an account. Approve the connection request in Zerion.');
      const signer = await provider.getSigner();
      setWallet(await signer.getAddress());
      const walletName = zerion?.provider === selected ? 'Zerion' : (announced.find(item => item.provider === selected)?.info?.name || 'EVM');
      setNotice(walletName + ' wallet connected. Your connected address will be used as the refund address.');
      selected.on?.('accountsChanged', next => setWallet(next?.[0] || ''));
      selected.on?.('chainChanged', () => setQuote(null));
    } catch (error) {
      setNotice(error?.code === 4001 ? 'Connection was rejected in your wallet. Tap Connect EVM and approve the request.' : 'EVM wallet connection failed: ' + (error?.message || 'Unknown wallet error'));
    } finally { setWalletAction(''); }
  }

  async function createQuote() {
    const requestId = ++quoteRequestRef.current;
    setQuote(null); setTxHash(''); setSwapStatus('');
    if (isNearToken(origin || {}) ? !nearWallet : !wallet) return setNotice(isNearToken(origin || {}) ? 'Connect your NEAR wallet first. It will be used for refunds.' : 'Connect your EVM wallet first. The connected address is used for refunds.');
    if (!origin || !destination || !amount || Number(amount) <= 0 || !recipient.trim()) return setNotice('Complete the origin token, destination token, amount, and merchant payout address.');
    if (recipient.startsWith('0x') && !isAddress(recipient)) return setNotice('The merchant EVM payout address is invalid.');
    if (!recipient.startsWith('0x') && !/^[a-z0-9._-]{2,64}$/i.test(recipient)) return setNotice('Enter a valid EVM address or NEAR account ID.');
    let atomicAmount;
    try { atomicAmount = parseUnits(amount, Number(origin.decimals)).toString(); }
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
          swapType: 'EXACT_INPUT',
          slippageTolerance: 100
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Quote request failed.');
      if (requestId !== quoteRequestRef.current) return;
      setQuote(data);
      setNotice('Quote ready. Review the amount, payout details, and expiry before approving payment.');
    } catch (e) {
      if (requestId === quoteRequestRef.current) setNotice(e.message || 'Could not create quote.');
    }
    finally { if (requestId === quoteRequestRef.current) setBusy(false); }
  }

  useEffect(() => {
    const complete = Boolean(
      configured && origin && destination && amount && Number(amount) > 0 &&
      recipient.trim() && (isNearToken(origin) ? nearWallet : wallet)
    );
    // Invalidate any quote response still in flight when an input changes.
    quoteRequestRef.current += 1;
    setQuote(null);
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
          if (statusData.status === 'SUCCESS') setNotice('Payment completed. 1Click reports that the merchant payout was delivered.');
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
      setNotice(data.status === 'SUCCESS' ? 'Payment completed and delivered.' : `Current payment status: ${data.status || 'UNKNOWN'}`);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <nav className="nav"><a className="brand" href="#"><span className="brand-mark">I</span> IntentPay</a><div className="nav-right"><span className="status"><i />{health}</span><button type="button" className="wallet-btn" onClick={connectWallet} disabled={walletAction === "evm"}>{wallet ? short(wallet) : walletAction === 'evm' ? 'Connecting…' : 'Connect EVM'}</button><button type="button" className="wallet-btn" onClick={connectNearWallet} disabled={walletAction === 'near'}>{nearWallet ? short(nearWallet) : walletAction === 'near' ? 'Opening…' : 'Connect NEAR'}</button></div></nav>
    <section className="hero"><div className="eyebrow">CROSS-CHAIN CHECKOUT · POWERED BY NEAR INTENTS</div><h1>One checkout.<br/><span>Any supported chain.</span></h1><p>Customers pay from a supported network. Merchants receive their selected asset at their payout address.</p></section>
    <section className="checkout">
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
        <label>Amount</label><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />{origin && <p className="balance-line">{balanceLoading ? 'Checking wallet balance…' : originBalance !== '' ? <>Wallet balance: <strong>{Number(originBalance).toLocaleString(undefined, { maximumFractionDigits: 8 })} {origin.symbol}</strong></> : balanceError}</p>}
        <div className="section-rule"><span>MERCHANT RECEIVES</span></div>
        <label>Choose payout network</label>
        <select value={destinationChain} onChange={e => { setDestinationChain(e.target.value); setDestinationAsset(''); }} required>
          <option value="">Select merchant payout network</option>
          {destinationChains.map(chain => <option key={chain} value={chain}>{chainLabel(chain)}</option>)}
        </select>
        <label>Choose payout token</label>
        <select value={destinationAsset} onChange={e => setDestinationAsset(e.target.value)} required disabled={!destinationChain || loadingTokens}>
          <option value="">{!destinationChain ? 'Choose a payout network first' : 'Select available payout token'}</option>
          {destinationTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name ? ' · ' + t.name : ''}</option>)}
        </select>
        {destinationChain && destinationTokens.length === 0 && <p className="warning">No payout tokens are currently listed for {chainLabel(destinationChain)} in the live NEAR Intents registry. Choose another network.</p>}
        {destinationChain && destinationTokens.length > 0 && !destinationTokens.some(t => String(t.symbol || '').toUpperCase() === 'USDT') && <p className="helper-text">USDT is not currently listed as a supported payout token on {chainLabel(destinationChain)} by NEAR Intents. Other listed tokens are shown above.</p>}
        <label>{destinationIsNear ? 'Merchant NEAR account address' : 'Merchant EVM wallet address'}</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={recipientPlaceholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={!destinationChain || !destinationAsset} /><p className="helper-text">{!destinationChain ? 'Choose a payout network and token first. The required address format will appear here.' : !destinationAsset ? 'Choose a payout token to see the correct merchant address format.' : destinationIsNear ? 'Enter the merchant’s NEAR account ID, for example merchant.near' : 'Enter the merchant’s EVM address for this network, starting with 0x'}</p>
        <div className="refund-note">Refund address: {isNearToken(origin || {}) ? (nearWallet ? short(nearWallet) : 'Connect NEAR wallet') : (wallet ? short(wallet) : 'Connect EVM wallet')}</div>
        <div className="quote-auto-state" role="status">{busy ? 'Getting your quote…' : quote ? 'Quote ready. Review it below.' : 'Your quote will be generated automatically when all selections are complete.'}</div>
      </form>
      {!configured && <p className="warning">Mainnet payments are locked until the server has a valid 1Click JWT. Add it as a Vercel server environment variable. Never paste it into this page.</p>}
      <p className="notice">{notice}</p>
      {quote?.quote && <div className="quote-card">
        <div className="quote-title">Mainnet quote details</div>
        <div className="quote-row"><span>Pay</span><strong>{quote.quote.amountInFormatted || formatUnits(quote.quote.amountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>
        <div className="quote-row"><span>Estimated receive</span><strong>{(quote.quote.amountOutFormatted || quote.quote.amountOut) + ' ' + destination?.symbol}</strong></div>
        <div className="quote-row"><span>Merchant address</span><strong>{short(recipient)}</strong></div>
        <div className="quote-row"><span>Quote expires</span><strong>{quote.quote.deadline ? new Date(quote.quote.deadline).toLocaleTimeString() : 'Provider-defined'}</strong></div>
        {<div className="deposit-address"><span>Unique deposit address</span><code>{quote.quote.depositAddress}</code></div>}
        {quote.quote.depositMemo && <div className="deposit-address"><span>Required memo</span><code>{quote.quote.depositMemo}</code></div>}
        <button className="primary" onClick={sendDeposit} disabled={busy || Boolean(txHash)}>{txHash ? 'Deposit submitted' : 'Pay from connected wallet'}</button>
        {txHash && <div className="tx-details"><span>Deposit transaction</span><code>{short(txHash)}</code><span>Status: {swapStatus || 'Waiting'}</span></div>}
        {txHash && <button className="secondary" onClick={refreshStatus} disabled={busy}>Refresh payment status</button>}
        <p className="fineprint">MAINNET TRANSACTION · This approval transfers real assets. Verify the wallet network, token, amount, merchant address, quote expiry, and deposit address before signing. Never send a different asset to this address.</p>
      </div>}
      <div className="fineprint">{loadingTokens ? 'Loading live 1Click assets…' : `${tokens.length} live assets loaded`} · EVM and NEAR wallet deposits enabled for supported listed assets.</div>
    </section>
    <footer><span>IntentPay</span><span>Non-custodial cross-chain checkout</span></footer>
  </main>;
}
