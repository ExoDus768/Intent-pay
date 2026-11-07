import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

const HISTORY_KEY = 'intentpay_invoice_history_v1';
const SECRET_KEY = 'intentpay_webhook_secrets_v1';
const SUPPORTED_PAYOUT_CHAINS = new Set(['eth','ethereum','base','arb','arbitrum','op','optimism','polygon','bsc','avax','avalanche','gnosis','bera','berachain','scroll','aurora','near']);
const chainLabel = value => ({eth:'Ethereum',ethereum:'Ethereum',arb:'Arbitrum',arbitrum:'Arbitrum',op:'Optimism',optimism:'Optimism',avax:'Avalanche',avalanche:'Avalanche',bera:'Berachain'}[String(value || '').toLowerCase()] || String(value || '').replace(/[-_]+/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase()));

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(0, 30); }
  catch { return []; }
}

export default function MerchantTools({ tokens = [], defaultRecipient = '', open = false, onClose = () => {} }) {
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
  const [widgetInvoiceId, setWidgetInvoiceId] = useState('');
  const [qr, setQr] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (defaultRecipient && !recipient) setRecipient(defaultRecipient);
  }, [defaultRecipient]);

  const chains = useMemo(() => [...new Set(tokens.map(t => String(t.blockchain || '').toLowerCase()).filter(value => SUPPORTED_PAYOUT_CHAINS.has(value)))].sort(), [tokens]);
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
    if (open && (tab === 'dashboard' || tab === 'widget')) refreshInvoices();
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
      setWidgetInvoiceId(invoice.id);
      setInvoices(current => [invoice, ...current.filter(item => item.id !== invoice.id)]);
      setQr(await QRCode.toDataURL(shareUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' }));
      setNotice('Invoice created. Share the link or QR code with your customer.');
      setTab('create');
    } catch (e) { setError(e.message || 'Could not create invoice.'); }
    finally { setBusy(false); }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) { setError('This browser does not support desktop notifications.'); return; }
    const permission = await Notification.requestPermission();
    setNotice(permission === 'granted' ? 'Payment notifications enabled for this browser.' : 'Notification permission was not granted.');
  }

  async function retryWebhook(id) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/invoices/' + encodeURIComponent(id) + '/webhook/retry', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Webhook retry failed.');
      await refreshInvoices();
      setNotice(data.webhookDelivered ? 'Webhook delivered successfully.' : 'Webhook retry attempted. Check the delivery status.');
    } catch (e) { setError(e.message || 'Webhook retry failed.'); }
    finally { setBusy(false); }
  }

  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setNotice(label + ' copied.'); }
    catch { setError('Clipboard access was blocked. Select and copy the value manually.'); }
  }

  const selected = tokens.find(t => t.assetId === asset);
  const selectedNear = String(selected?.blockchain || '').toLowerCase() === 'near';
  const widgetCheckoutUrl = widgetInvoiceId ? window.location.origin + '/?invoice=' + encodeURIComponent(widgetInvoiceId) : '';
  const widgetSnippet = widgetInvoiceId ? '<button type="button" data-intentpay-checkout data-intentpay-invoice="' + widgetInvoiceId + '">Pay with crypto</button>\n<script src="' + window.location.origin + '/intentpay.js" defer></script>' : '';

  return <>
    {open && <div className="merchant-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="merchant-modal" role="dialog" aria-modal="true" aria-labelledby="merchant-title">
        <div className="merchant-modal-head">
          <div><div className="eyebrow">INTENTPAY MERCHANT</div><h2 id="merchant-title">Merchant workspace</h2></div>
          <button type="button" className="merchant-close" aria-label="Close merchant workspace" onClick={onClose}>×</button>
        </div>
        <div className="merchant-tabs">
          <button type="button" className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Create invoice</button>
          <button type="button" className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Dashboard</button>
          <button type="button" className={tab === 'widget' ? 'active' : ''} onClick={() => setTab('widget')}>Checkout widget</button>
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
        {tab === 'widget' && <div className="merchant-widget-panel">
          <div className="widget-intro">
            <span className="eyebrow">UNIVERSAL CHECKOUT</span>
            <h3>Add IntentPay to your website</h3>
            <p>Choose one of your payment invoices, then copy the small code snippet into your store or website. Your customer will open the hosted IntentPay checkout.</p>
          </div>
          <label htmlFor="widget-invoice-select">Payment invoice</label>
          <select id="widget-invoice-select" value={widgetInvoiceId} onChange={event => setWidgetInvoiceId(event.target.value)}>
            <option value="">Select an invoice</option>
            {invoices.map(item => <option key={item.id} value={item.id}>{item.description || 'Payment invoice'} · {item.amount} {item.symbol} · {String(item.id).slice(0, 8)}</option>)}
          </select>
          {widgetInvoiceId ? <>
            <div className="widget-preview">
              <span className="widget-preview-label">BUTTON PREVIEW</span>
              <button type="button" className="widget-preview-button" onClick={() => window.open(widgetCheckoutUrl, '_blank', 'noopener,noreferrer')}>Pay with crypto <span>↗</span></button>
              <small>Preview opens the hosted checkout in a new tab. It does not make a payment.</small>
            </div>
            <label>Embed code</label>
            <pre className="widget-code">{widgetSnippet}</pre>
            <button type="button" className="primary" onClick={() => copy(widgetSnippet, 'Widget embed code')}>Copy embed code</button>
            <label>Direct checkout link</label>
            <div className="widget-direct-link"><code>{widgetCheckoutUrl}</code><button type="button" className="secondary" onClick={() => copy(widgetCheckoutUrl, 'Checkout link')}>Copy link</button></div>
          </> : <p className="empty-invoices">Create a payment invoice first, or open Dashboard to refresh your saved invoices. Then select it here to generate the embed code.</p>}
          <p className="merchant-hint">The widget button only opens checkout. A payment is complete only after the invoice status confirms SUCCESS. Persistent invoice storage must be enabled for reliable merchant use.</p>
          {error && <p className="merchant-error">{error}</p>}
        </div>}
        {tab === 'dashboard' && <div className="merchant-dashboard">
          <div className="dashboard-summary"><div><span>Invoices saved on this device</span><strong>{invoices.length}</strong></div><button type="button" className="secondary refresh-invoices" onClick={refreshInvoices} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
          <div className="dashboard-metrics"><div><span>Paid</span><strong>{invoices.filter(item => item.status === 'SUCCESS').length}</strong></div><div><span>Pending</span><strong>{invoices.filter(item => ['CREATED','PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING'].includes(item.status)).length}</strong></div><div><span>Failed / refunded</span><strong>{invoices.filter(item => ['FAILED','REFUNDED','INCOMPLETE_DEPOSIT'].includes(item.status)).length}</strong></div></div>
          <button type="button" className="secondary notification-enable" onClick={enableNotifications}>Enable payment notifications</button>
          <p className="merchant-hint">Invoice records and payment status are stored server-side. This browser keeps the invoice IDs for your dashboard list; save or share links if you use another device.</p>
          {error && <p className="merchant-error">{error}</p>}
          {invoices.length === 0 ? <p className="empty-invoices">No invoices found yet. Create your first payment link.</p> : invoices.map(invoice => <article className="invoice-row" key={invoice.id}>
            <div className="invoice-row-top"><strong>{invoice.amount} {invoice.symbol}</strong><span className={'invoice-status status-' + String(invoice.status || 'created').toLowerCase()}>{invoice.status || 'CREATED'}</span></div>
            <p>{invoice.description || 'Payment invoice'} · {chainLabel(invoice.destinationChain)}</p>
            <small>{new Date(invoice.createdAt).toLocaleString()}</small>
            <div className="invoice-row-actions"><button type="button" className="secondary" onClick={() => copy(new URL('/?invoice=' + encodeURIComponent(invoice.id), window.location.origin).toString(), 'Payment link')}>Copy link</button><button type="button" className="secondary" onClick={() => window.open('/?invoice=' + encodeURIComponent(invoice.id), '_blank', 'noopener,noreferrer')}>Open</button></div>
            {invoice.webhookConfigured && <><small>Webhook: {invoice.webhookDelivered ? 'Delivered' : invoice.webhookLastError ? 'Delivery failed: ' + invoice.webhookLastError : 'Waiting for successful payment'}</small>{invoice.status === 'SUCCESS' && invoice.webhookLastError && <button type="button" className="secondary" onClick={() => retryWebhook(invoice.id)} disabled={busy}>Retry webhook</button>}</>}
          </article>)}
        </div>}
        <div className="merchant-modal-foot">Powered by NEAR Intents · Mainnet payments only · Never ask customers to send funds outside the generated 1Click deposit address.</div>
      </section>
    </div>}
  </>;
}
