import { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, isAddress } from 'ethers';

const short = (value = '') => value.length > 18 ? value.slice(0, 8) + '…' + value.slice(-6) : value;
const tokenId = (t) => t.assetId || t.asset_id || t.asset || t.id || '';
const tokenSymbol = (t) => t.symbol || t.ticker || 'TOKEN';
const tokenChain = (t) => t.blockchain || t.chain || t.network || 'Unknown network';

export default function App() {
  const [health, setHealth] = useState('Checking service…');
  const [tokens, setTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [wallet, setWallet] = useState('');
  const [network, setNetwork] = useState('');
  const [search, setSearch] = useState('');
  const [selectedToken, setSelectedToken] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Choose a token and enter the merchant payout address to prepare a quote.');

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setHealth(d.ok ? 'Service online' : 'Service unavailable')).catch(() => setHealth('Backend not connected'));
    fetch('/api/tokens').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : (d.tokens || d.data || []);
      setTokens(list);
    }).catch(() => setNotice('Could not load the token registry. Check the backend and try again.')).finally(() => setLoadingTokens(false));
  }, []);

  const filtered = useMemo(() => tokens.filter(t => {
    const text = [tokenSymbol(t), tokenChain(t), tokenId(t), t.name || ''].join(' ').toLowerCase();
    return text.includes(search.toLowerCase()) && (!network || tokenChain(t) === network);
  }), [tokens, search, network]);

  const networks = useMemo(() => [...new Set(tokens.map(tokenChain))].sort(), [tokens]);

  async function connectWallet() {
    if (!window.ethereum) return setNotice('Install or open MetaMask or another EVM wallet to connect.');
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      setWallet(await signer.getAddress());
      setNotice('Wallet connected. Select a supported asset to continue.');
    } catch (e) { setNotice(e.message || 'Wallet connection was cancelled.'); }
  }

  async function requestQuote(e) {
    e.preventDefault();
    setQuote(null);
    if (!selectedToken || !amount || Number(amount) <= 0 || !recipient.trim()) return setNotice('Complete the token, amount, and merchant payout address fields.');
    if (recipient.startsWith('0x') && !isAddress(recipient)) return setNotice('The EVM payout address is not valid.');
    setBusy(true);
    try {
      const response = await fetch('/api/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIn: selectedToken, amount, recipient })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Quote request failed.');
      setQuote(data);
      setNotice('Quote response received. Review all details before proceeding.');
    } catch (e) { setNotice(e.message || 'Could not create quote.'); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <nav className="nav"><a className="brand" href="#"><span className="brand-mark">I</span> IntentPay</a><div className="nav-right"><span className="status"><i />{health}</span><button className="wallet-btn" onClick={connectWallet}>{wallet ? short(wallet) : 'Connect wallet'}</button></div></nav>
    <section className="hero"><div className="eyebrow">CROSS-CHAIN CHECKOUT · POWERED BY NEAR INTENTS</div><h1>One checkout.<br/><span>Any supported chain.</span></h1><p>Let customers pay with supported tokens while merchants receive their preferred asset and network.</p></section>
    <section className="checkout">
      <div className="checkout-head"><div><div className="eyebrow">PAYMENT REQUEST</div><h2>Create a checkout quote</h2></div><span className="pill">Starter preview</span></div>
      <form onSubmit={requestQuote}>
        <label>Find a payment token</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search token or network…" />
        <div className="filters"><select value={network} onChange={e => setNetwork(e.target.value)}><option value="">All supported networks</option>{networks.map(n => <option key={n}>{n}</option>)}</select><select value={selectedToken} onChange={e => setSelectedToken(e.target.value)}><option value="">Select token</option>{filtered.map((t,i) => <option key={tokenId(t) || i} value={tokenId(t)}>{tokenSymbol(t)} · {tokenChain(t)}</option>)}</select></div>
        <label>Amount to pay</label><input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        <label>Merchant payout address</label><input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="EVM address or NEAR account" />
        <button className="primary" disabled={busy || loadingTokens}>{busy ? 'Requesting quote…' : 'Get payment quote'}</button>
      </form>
      <p className="notice">{notice}</p>
      {quote && <pre className="quote">{JSON.stringify(quote, null, 2)}</pre>}
      <div className="fineprint">{loadingTokens ? 'Loading supported assets…' : tokens.length ? `${tokens.length} assets returned by the live token registry` : 'No token data available yet.'} · This preview does not submit a payment.</div>
    </section>
    <footer><span>IntentPay</span><span>Non-custodial checkout concept</span></footer>
  </main>;
}
