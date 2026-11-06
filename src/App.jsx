import { useEffect, useMemo, useState } from 'react';
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
const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT']);
const tokenChain = t => String(t.blockchain || '').toLowerCase();
const isNearToken = t => tokenChain(t) === 'near';
const tokenId = t => t.assetId || '';
const tokenName = t => `${t.symbol || 'TOKEN'} · ${t.blockchain || 'Unknown chain'}`;
const short = (value = '') => value.length > 24 ? value.slice(0, 10) + '…' + value.slice(-8) : value;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const [health, setHealth] = useState('Checking service…');
  const [configured, setConfigured] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [wallet, setWallet] = useState('');
  const [nearWallet, setNearWallet] = useState('');
  const [nearSelector, setNearSelector] = useState(null);
  const [nearModal, setNearModal] = useState(null);
  const [originAsset, setOriginAsset] = useState('');
  const [destinationAsset, setDestinationAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quote, setQuote] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [swapStatus, setSwapStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Connect your EVM wallet, choose the asset you will pay with, and set the merchant payout details.');

  useEffect(() => {
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
  const destinations = useMemo(() => tokens, [tokens]);

  async function connectNearWallet() {
    if (!nearModal) return setNotice('NEAR wallet is still loading. Please try again shortly.');
    nearModal.show();
  }

  async function connectWallet() {
    if (!window.ethereum) return setNotice('Open MetaMask or another injected EVM wallet in this browser.');
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      setWallet(await signer.getAddress());
      setNotice('Wallet connected. Your wallet address will be used as the refund address.');
    } catch (e) { setNotice(e.message || 'Wallet connection was cancelled.'); }
  }

  async function createQuote(e) {
    e.preventDefault();
    setQuote(null); setTxHash(''); setSwapStatus('');
    if (!demoMode && (isNearToken(origin || {}) ? !nearWallet : !wallet)) return setNotice(isNearToken(origin || {}) ? 'Connect your NEAR wallet first. It will be used for refunds.' : 'Connect your EVM wallet first. The connected address is used for refunds.');
    if (!origin || !destination || !amount || Number(amount) <= 0 || !recipient.trim()) return setNotice('Complete the origin token, destination token, amount, and merchant payout address.');
    if (recipient.startsWith('0x') && !isAddress(recipient)) return setNotice('The merchant EVM payout address is invalid.');
    if (!recipient.startsWith('0x') && !/^[a-z0-9._-]{2,64}$/i.test(recipient)) return setNotice('Enter a valid EVM address or NEAR account ID.');
    let atomicAmount;
    try { atomicAmount = parseUnits(amount, Number(origin.decimals)).toString(); }
    catch { return setNotice('The amount has too many decimal places for the selected token.'); }

    setBusy(true);
    if (demoMode) {
      setQuote({ demo: true, quote: {
        amountIn: atomicAmount,
        amountInFormatted: amount,
        amountOutFormatted: 'Not priced in demo mode',
        depositAddress: 'SIMULATION ONLY — DO NOT SEND FUNDS',
        deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      }});
      setSwapStatus('SIMULATED');
      setNotice('Demo quote created. No wallet transaction will be requested and no funds will move.');
      setBusy(false);
      return;
    }
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
      setQuote(data);
      setNotice('Quote reserved. Check the amount, payout details, and expiry before sending funds.');
    } catch (e) { setNotice(e.message || 'Could not create quote.'); }
    finally { setBusy(false); }
  }

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
        const result = await walletClient.signAndSendTransactions({ transactions });
        const hash = result?.[0]?.transaction?.hash || result?.[0]?.transaction_outcome?.id || result?.transaction?.hash;
        if (!hash) throw new Error('Wallet returned without a transaction hash. Check your NEAR wallet activity before trying again.');
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
    if (!window.ethereum) return setNotice('Open MetaMask or another injected EVM wallet in this browser.');
    const expectedChain = CHAIN_IDS[chainKey];
    if (!expectedChain) return setNotice(`Wallet deposits from ${origin.blockchain} are not enabled in this EVM checkout yet.`);

    setBusy(true);
    try {
      let provider = new BrowserProvider(window.ethereum);
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
      setNotice(data.status === 'SUCCESS' ? 'Payment completed and delivered.' : `Current payment status: ${data.status || 'UNKNOWN'}`);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <nav className="nav"><a className="brand" href="#"><span className="brand-mark">I</span> IntentPay</a><div className="nav-right"><span className="status"><i />{health}</span><button className="wallet-btn" onClick={connectWallet}>{wallet ? short(wallet) : 'Connect EVM'}</button><button className="wallet-btn" onClick={connectNearWallet}>{nearWallet ? short(nearWallet) : 'Connect NEAR'}</button></div></nav>
    <section className="hero"><div className="eyebrow">CROSS-CHAIN CHECKOUT · POWERED BY NEAR INTENTS</div><h1>One checkout.<br/><span>Any supported chain.</span></h1><p>Customers pay from a supported network. Merchants receive their selected asset at their payout address.</p></section>
    <section className="checkout">
      <div className="checkout-head"><div><div className="eyebrow">MERCHANT CHECKOUT</div><h2>Configure payment</h2></div><div className="mode-switch">
        <button type="button" className={demoMode ? 'mode-active' : ''} onClick={() => { setDemoMode(true); setQuote(null); setTxHash(''); setSwapStatus(''); }}>Demo</button>
        <button type="button" className={!demoMode ? 'mode-active' : ''} disabled={!configured} onClick={() => { setDemoMode(false); setQuote(null); setTxHash(''); setSwapStatus(''); }}>Live payment</button>
      </div></div>
      <form onSubmit={createQuote}>
        <label>Customer pays with</label>
        <select value={originAsset} onChange={e => setOriginAsset(e.target.value)} required>
          <option value="">Choose payment token and network</option>
          {origins.map(t => <option key={t.assetId} value={t.assetId}>{tokenName(t)}</option>)}
        </select>
        <label>Amount</label><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
        <div className="section-rule"><span>MERCHANT RECEIVES</span></div>
        <label>Payout token and network</label>
        <select value={destinationAsset} onChange={e => setDestinationAsset(e.target.value)} required>
          <option value="">Choose merchant payout asset</option>
          {destinations.map(t => <option key={t.assetId} value={t.assetId}>{tokenName(t)}</option>)}
        </select>
        <label>Merchant payout address</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="EVM address or NEAR account" required />
        <div className="refund-note">Refund address: {isNearToken(origin || {}) ? (nearWallet ? short(nearWallet) : 'Connect NEAR wallet') : (wallet ? short(wallet) : 'Connect EVM wallet')}</div>
        <button className="primary" disabled={busy || loadingTokens}>{busy ? 'Please wait…' : demoMode ? 'Create demo quote' : 'Get live payment quote'}</button>
      </form>
      {demoMode
        ? <p className="demo-note">DEMO MODE · Illustrative values only. No deposit address is created and no assets are transferred.</p>
        : !configured && <p className="warning">Add your 1Click JWT as a server environment variable before requesting live quotes. Never paste it into this page.</p>}
      <p className="notice">{notice}</p>
      {quote?.quote && <div className="quote-card">
        <div className="quote-title">{quote.demo ? 'Demo quote — no funds move' : 'Live quote details'}</div>
        <div className="quote-row"><span>Pay</span><strong>{quote.quote.amountInFormatted || formatUnits(quote.quote.amountIn, Number(origin?.decimals || 0))} {origin?.symbol}</strong></div>
        <div className="quote-row"><span>Estimated receive</span><strong>{quote.demo ? 'Not priced in demo' : (quote.quote.amountOutFormatted || quote.quote.amountOut) + ' ' + destination?.symbol}</strong></div>
        <div className="quote-row"><span>Merchant address</span><strong>{short(recipient)}</strong></div>
        <div className="quote-row"><span>Quote expires</span><strong>{quote.quote.deadline ? new Date(quote.quote.deadline).toLocaleTimeString() : 'Provider-defined'}</strong></div>
        {!quote.demo && <div className="deposit-address"><span>Unique deposit address</span><code>{quote.quote.depositAddress}</code></div>}
        {quote.quote.depositMemo && <div className="deposit-address"><span>Required memo</span><code>{quote.quote.depositMemo}</code></div>}
        {quote.demo
          ? <button className="primary" onClick={() => { setSwapStatus('SIMULATED_SUCCESS'); setNotice('Simulation complete. No funds were transferred and no real payment was made.'); }}>Simulate payment — no funds move</button>
          : <button className="primary" onClick={sendDeposit} disabled={busy || Boolean(txHash)}>{txHash ? 'Deposit submitted' : 'Pay from connected wallet'}</button>}
        {!quote.demo && txHash && <div className="tx-details"><span>Deposit transaction</span><code>{short(txHash)}</code><span>Status: {swapStatus || 'Waiting'}</span></div>}
        {!quote.demo && txHash && <button className="secondary" onClick={refreshStatus} disabled={busy}>Refresh payment status</button>}
        <p className="fineprint">{quote.demo ? 'This is a visual demo only. It does not call 1Click, create a deposit address, or send any funds.' : 'Only proceed if the wallet, token, amount, and deposit address are correct. Never send a different asset to this address.'}</p>
      </div>}
      <div className="fineprint">{loadingTokens ? 'Loading live 1Click assets…' : `${tokens.length} live assets loaded`} · EVM and NEAR wallet deposits enabled for supported listed assets.</div>
    </section>
    <footer><span>IntentPay</span><span>Non-custodial cross-chain checkout</span></footer>
  </main>;
}
