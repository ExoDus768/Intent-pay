import { useMemo, useState } from 'react';

const INVOICE_ID_PATTERN = /^[a-f0-9]{24,64}$/i;

export default function MerchantTools({ open = false, onClose = () => {} }) {
  const [invoiceId, setInvoiceId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const validInvoiceId = INVOICE_ID_PATTERN.test(invoiceId.trim());
  const checkoutUrl = useMemo(
    () => validInvoiceId ? window.location.origin + '/?invoice=' + encodeURIComponent(invoiceId.trim()) : '',
    [invoiceId, validInvoiceId]
  );
  const embedCode = checkoutUrl
    ? '<button type="button" data-intentpay-checkout data-intentpay-invoice="' + invoiceId.trim() + '">Pay with crypto</button>\\n<script src="' + window.location.origin + '/intentpay.js" defer></script>'
    : '';

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setError('');
      setNotice(label + ' copied.');
    } catch {
      setNotice('');
      setError('Clipboard access was blocked. Select and copy the value manually.');
    }
  }

  if (!open) return null;

  return (
    <div className="merchant-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="merchant-modal" role="dialog" aria-modal="true" aria-labelledby="merchant-title">
        <div className="merchant-modal-head">
          <div><div className="eyebrow">INTENTPAY MERCHANT</div><h2 id="merchant-title">Merchant workspace</h2></div>
          <button type="button" className="merchant-close" aria-label="Close merchant workspace" onClick={onClose}>×</button>
        </div>

        <div className="merchant-widget-panel">
          <div className="widget-intro">
            <span className="eyebrow">UNIVERSAL CHECKOUT</span>
            <h3>Build with the checkout widget</h3>
            <p>Connect an existing IntentPay invoice to a checkout button on your website. Customers can pay from a supported wallet and network through the hosted NEAR Intents checkout.</p>
          </div>

          <label htmlFor="widget-invoice-id">Invoice ID</label>
          <input
            id="widget-invoice-id"
            value={invoiceId}
            onChange={event => { setInvoiceId(event.target.value.trim()); setNotice(''); setError(''); }}
            placeholder="Paste an existing invoice ID"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {invoiceId && !validInvoiceId && <p className="merchant-error">Enter a valid invoice ID (24–64 hexadecimal characters).</p>}

          {validInvoiceId && <>
            <div className="widget-preview">
              <span className="widget-preview-label">BUTTON PREVIEW</span>
              <button type="button" className="widget-preview-button" onClick={() => window.open(checkoutUrl, '_blank', 'noopener,noreferrer')}>Pay with crypto <span>↗</span></button>
              <small>Preview opens the hosted checkout. It does not make a payment.</small>
            </div>
            <label>Embed code</label>
            <pre className="widget-code">{embedCode}</pre>
            <button type="button" className="primary" onClick={() => copy(embedCode, 'Widget embed code')}>Copy embed code</button>
            <label>Direct checkout link</label>
            <div className="widget-direct-link"><code>{checkoutUrl}</code><button type="button" className="secondary" onClick={() => copy(checkoutUrl, 'Checkout link')}>Copy link</button></div>
          </>}

          {!invoiceId && <p className="empty-invoices">Paste an existing invoice ID to generate your checkout button and direct payment link.</p>}
          <p className="merchant-hint">The widget opens hosted checkout only. A payment is complete only after the invoice status confirms SUCCESS. Keep your invoice ID private if it should not be shared publicly.</p>
          {error && <p className="merchant-error">{error}</p>}
          {notice && <p className="merchant-notice">{notice}</p>}
        </div>
        <div className="merchant-modal-foot">Powered by NEAR Intents · Mainnet payments only</div>
      </section>
    </div>
  );
}
