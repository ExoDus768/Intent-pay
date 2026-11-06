import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

const HISTORY_KEY = 'intentpay_invoice_history_v1';
const SECRET_KEY = 'intentpay_webhook_secrets_v1';
const chainLabel = value => ({eth:'Ethereum',ethereum:'Ethereum',arb:'Arbitrum',arbitrum:'Arbitrum',op:'Optimism',optimism:'Optimism',avax:'Avalanche',avalanche:'Avalanche',bera:'Berachain'}[String(value || '').toLowerCase()] || String(value || '').replace(/[-_]+/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase()));

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(0, 30); }
  catch { return []; }
}

export default function MerchantTools({ tokens = [], defaultRecipient = '' }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('create');
  const [chain, setChain] = useState('');
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [description, setDescription] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [history, setHistory] = useState(readHistory);
  const [invoices, setInvoices] = useState([]);
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (defaultRecipient && !recipient) setRecipient(defaultRecipient);
  }, [defaultRecipient]);

  const chains = useMemo(() => [...new Set(tokens.map(t => String(t.blockchain || '').toLowerCase()))].sort(), [tokens]);
  const chainTokens = useMemo(() => tokens.filter(t => String(t.blockchain || '').toLowerCase() === chain), [tokens, chain]);

  async function refreshInvoices() {
    setBusy(true);
    setError('');
    try {
      const results = await Promise.all(history.map(async id => {
        const response = await fetch('/api/invoices/' + encodeURIComponent(id));
        if (!response.ok) return null;
        return response.json();
      }));
      setInvoices(results.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
    } catch (e) { setError(e.message || 'Could not refresh invoices.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (open && tab === 'dashboard') refreshInvoices();
  }, [open, tab, history.join('|')]);

  async function createInvoice(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setLink('');
    setQr('');
    setWebhookSecret('');
    try {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationAsset: asset, amount: amount.trim(), recipient: recipient.trim(), description: description.trim(), webhookUrl: webhookUrl.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create invoice.');
      const invoice = data.invoice;
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('invoice', invoice.id);
      const shareUrl = url.toString();
      const nextHistory = [invoice.id, ...history.filter(id => id !== invoice.id)].slice(0, 30);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
      setHistory(nextHistory);
      if (data.webhookSecret) {
        const secrets = JSON.parse(localStorage.getItem(SECRET_KEY) || '{}');
        secrets[invoice.id] = data.webhookSecret;
        localStorage.setItem(SECRET_KEY, JSON.stringify(secrets));
        setWebhookSecret(data.webhookSecret);
      }
      setLink(shareUrl);
      setQr(await QRCode.toDataURL(shareUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' }));
      setNotice('Invoice created. Share the link or QR code with your customer.');
      setTab('create');
    } catch (e) { setError(e.message || 'Could not create invoice.'); }
    finally { setBusy(false); }
  }

  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setNotice(label + ' copied.'); }
    catch { setError('Clipboard access was blocked. Select and copy the value manually.'); }
  }

  const selected = tokens.find(t => t.assetId === asset);
  const selectedNear = String(selected?.blockchain || '').toLowerCase() === 'near';

  return <>
    <button type="button" className="merchant-tools-btn" onClick={() => setOpen(true)}>Merchant tools</button>
    {open && <div className="merchant-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="merchant-modal" role="dialog" aria-modal="true" aria-labelledby="merchant-title">
        <div className="merchant-modal-head">
          <div><div className="eyebrow">INTENTPAY MERCHANT</div><h2 id="merchant-title">Merchant workspace</h2></div>
          <button type="button" className="merchant-close" aria-label="Close merchant workspace" onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="merchant-tabs">
          <button type="button" className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Create invoice</button>
          <button type="button" className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
        </div>
        {tab === 'create' && <form className="merchant-form" onSubmit={createInvoice}>
          <p className="merchant-intro">Create a fixed-output payment link. NEAR Intents will calculate how much the customer must deposit from their chosen supported asset.</p>
          <label>Payout network</label>
          <select value={chain} onChange={e => { setChain(e.target.value); setAsset(''); }} required>
            <option value="">Select payout network</option>
            {chains.map(value => <option key={value} value={value}>{chainLabel(value)}</option>)}
          </select>
          <label>Payout token</label>
          <select value={asset} onChange={e => setAsset(e.target.value)} required disabled={!chain}>
            <option value="">Select payout token</option>
            {chainTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol} · {t.name || chainLabel(t.blockchain)}</option>)}
          </select>
          <label>Exact amount merchant receives</label>
          <input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 25.00" required />
          <label>{selectedNear ? 'Merchant NEAR account' : 'Merchant EVM payout address'}</label>
          <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={selectedNear ? 'merchant.near' : '0x...'} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <label>Invoice description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Design service" maxLength={140} />
          <label>Webhook URL (optional, HTTPS)</label>
          <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://your-store.com/api/intentpay" type="url" />
          <p className="merchant-hint">Webhook events are signed with a unique secret shown once after creation. Keep it private.</p>
          <button className="primary" type="submit" disabled={busy || !asset || !amount || !recipient}>{busy ? 'Creating invoice…' : 'Create payment link'}</button>
          {error && <p className="merchant-error">{error}</p>}
          {notice && <p className="merchant-notice">{notice}</p>}
          {link && <div className="invoice-created">
            {qr && <img src={qr} alt="QR code for this IntentPay invoice" />}
            <div className="invoice-link-value"><strong>Shareable payment link</strong><code>{link}</code><button type="button" className="secondary" onClick={() => copy(link, 'Payment link')}>Copy payment link</button></div>
            {webhookSecret && <div className="webhook-secret"><strong>Webhook signing secret — save this now</strong><code>{webhookSecret}</code><button type="button" className="secondary" onClick={() => copy(webhookSecret, 'Webhook secret')}>Copy webhook secret</button></div>}
          </div>}
        </form>}
        {tab === 'dashboard' && <div className="merchant-dashboard">
          <div className="dashboard-summary"><div><span>Invoices saved on this device</span><strong>{invoices.length}</strong></div><button type="button" className="secondary refresh-invoices" onClick={refreshInvoices} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
          <p className="merchant-hint">Invoice records and payment status are stored server-side. This browser keeps the invoice IDs for your dashboard list; save or share links if you use another device.</p>
          {error && <p className="merchant-error">{error}</p>}
          {invoices.length === 0 ? <p className="empty-invoices">No invoices found yet. Create your first payment link.</p> : invoices.map(invoice => <article className="invoice-row" key={invoice.id}>
            <div className="invoice-row-top"><strong>{invoice.amount} {invoice.symbol}</strong><span className={'invoice-status status-' + String(invoice.status || 'created').toLowerCase()}>{invoice.status || 'CREATED'}</span></div>
            <p>{invoice.description || 'Payment invoice'} · {chainLabel(invoice.destinationChain)}</p>
            <small>{new Date(invoice.createdAt).toLocaleString()}</small>
            <div className="invoice-row-actions"><button type="button" className="secondary" onClick={() => copy(new URL('/?invoice=' + encodeURIComponent(invoice.id), window.location.origin).toString(), 'Payment link')}>Copy link</button><button type="button" className="secondary" onClick={() => window.open('/?invoice=' + encodeURIComponent(invoice.id), '_blank', 'noopener,noreferrer')}>Open</button></div>
            {invoice.webhookConfigured && <small>Webhook: {invoice.webhookDelivered ? 'Delivered' : invoice.webhookLastError ? 'Delivery failed' : 'Waiting for successful payment'}</small>}
          </article>)}
        </div>}
        <div className="merchant-modal-foot">Powered by NEAR Intents · Mainnet payments only · Never ask customers to send funds outside the generated 1Click deposit address.</div>
      </section>
    </div>}
  </>;
}
