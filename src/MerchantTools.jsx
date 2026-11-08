import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export default function MerchantTools({ open = false, onClose = () => {}, tokens = [], page = false }) {
  const [mode, setMode] = useState('variable');
  const [merchantName, setMerchantName] = useState('');
  const [destinationChain, setDestinationChain] = useState('');
  const [destinationAsset, setDestinationAsset] = useState('');
  const [recipient, setRecipient] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [buttonLabel, setButtonLabel] = useState('Pay with crypto');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [nearAccountStatus, setNearAccountStatus] = useState('idle');
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState('');

  const chainOf = t => String(t?.blockchain || '').trim().toLowerCase();
  const chains = useMemo(() => [...new Set(tokens.filter(t => t?.assetId && chainOf(t)).map(chainOf))].sort(), [tokens]);
  const payoutTokens = useMemo(() => tokens
    .filter(t => t?.assetId && destinationChain && chainOf(t) === destinationChain)
    .sort((a, b) => String(a.symbol || '').localeCompare(String(b.symbol || ''))), [tokens, destinationChain]);
  const selected = tokens.find(t => String(t.assetId) === String(destinationAsset) && chainOf(t) === destinationChain);
  const isNearPayout = selected?.blockchain?.toLowerCase() === 'near';
  const nearAccountFormatValid = /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(recipient.trim()) && recipient.trim().length >= 2 && recipient.trim().length <= 64;
  const addressValid = isNearPayout ? nearAccountFormatValid && nearAccountStatus === 'registered' : /^0x[a-fA-F0-9]{40}$/.test(recipient.trim());

  useEffect(() => {
    if (!isNearPayout || !nearAccountFormatValid) {
      setNearAccountStatus('idle');
      return undefined;
    }
    let active = true;
    setNearAccountStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('https://rpc.mainnet.near.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'xoduspay-account-check',
            method: 'query',
            params: { request_type: 'view_account', finality: 'final', account_id: recipient.trim() }
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error('NEAR account lookup failed');
        if (!active) return;
        setNearAccountStatus(data.result?.amount !== undefined ? 'registered' : 'unregistered');
      } catch {
        if (active) setNearAccountStatus('unavailable');
      }
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [isNearPayout, nearAccountFormatValid, recipient]);
  const fixedTokenEstimate = selected && Number(selected.price) > 0 && Number(fixedAmount) > 0 ? Number(fixedAmount) / Number(selected.price) : null;
  const ready = Boolean(selected && addressValid && (mode === 'variable' || (fixedAmount && Number(fixedAmount) >= 0.01)));
  const config = useMemo(() => {
    if (!ready) return null;
    const params = new URLSearchParams({
      merchantAsset: destinationAsset,
      merchantRecipient: recipient.trim(),
      merchantName: merchantName.trim().slice(0, 80),
      ...(mode === 'fixed' ? { merchantAmountUsd: fixedAmount } : {})
    });
    return window.location.origin + '/checkout?' + params.toString();
  }, [ready, destinationAsset, recipient, merchantName, mode, fixedAmount]);
  const embed = config
    ? '<button type="button" data-intentpay-checkout data-intentpay-url="' + config + '">' + buttonLabel.trim() + '</button>\n<script src="' + window.location.origin + '/intentpay.js" defer></script>'
    : '';

  useEffect(() => {
    let active = true;
    setQrDataUrl('');
    setQrError('');
    if (!config) return () => { active = false; };
    QRCode.toDataURL(config, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#101a10', light: '#ffffff' }
    }).then(dataUrl => {
      if (active) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setQrError('QR code could not be generated. You can still copy the checkout link.');
    });
    return () => { active = false; };
  }, [config]);


  async function loadReceipts() {
    if (!selected || !recipient.trim() || !addressValid) return;
    setReceiptsLoading(true);
    setReceiptsError('');
    try {
      const params = new URLSearchParams({ assetId: destinationAsset, recipient: recipient.trim() });
      const response = await fetch('/api/merchant/receipts?' + params.toString(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load merchant receipts.');
      setReceipts(Array.isArray(data.receipts) ? data.receipts : []);
    } catch (err) {
      setReceiptsError(err.message || 'Could not load merchant receipts.');
    } finally { setReceiptsLoading(false); }
  }

  useEffect(() => {
    setReceipts([]);
    if (ready) loadReceipts();
  }, [ready, destinationAsset, recipient, addressValid]);

  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setError(''); setNotice(label + ' copied.'); }
    catch { setNotice(''); setError('Clipboard access was blocked. Select and copy the value manually.'); }
  }

  if (!open && !page) return null;
  return (
    <div className={page ? "merchant-page-wrapper" : "merchant-overlay"} role="presentation" onMouseDown={event => { if (!page && event.target === event.currentTarget) onClose(); }}>
      <section className={page ? "merchant-modal merchant-page-card" : "merchant-modal"} role="dialog" aria-modal="true" aria-labelledby="merchant-title">
        <div className="merchant-modal-head">
          <div><div className="eyebrow">XODUSPAY · UNIVERSAL CHECKOUT</div><h2 id="merchant-title">{page ? 'Merchant workspace' : 'Checkout workspace'}</h2></div>
          <button type="button" className="merchant-close" aria-label={page ? "Return home" : "Close checkout workspace"} onClick={onClose}>{page ? '←' : '×'}</button>
        </div>
        <div className="merchant-widget-panel">
          <div className="widget-intro">
            <span className="eyebrow">PUBLISH YOUR CHECKOUT</span>
            <h3>Set up your payment button</h3>
            <p>Configure where payments should arrive, choose whether customers enter an amount or pay a fixed price, then copy the button code into your website.</p>
          </div>

          <label htmlFor="intentpay-merchant-name">Business or payment name <span>(optional)</span></label>
          <input id="intentpay-merchant-name" value={merchantName} onChange={e => setMerchantName(e.target.value)} placeholder="e.g. Acme Store" maxLength={80} />

          <label>Payment amount</label>
          <div className="widget-mode-switch" role="group" aria-label="Choose payment amount type">
            <button type="button" className={mode === 'variable' ? 'active' : ''} aria-pressed={mode === 'variable'} onClick={() => setMode('variable')}>
              <span className="widget-mode-check">{mode === 'variable' ? '✓' : '＋'}</span>
              <strong>Customer enters amount</strong>
              <small>Let the customer choose what to pay</small>
            </button>
            <button type="button" className={mode === 'fixed' ? 'active' : ''} aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>
              <span className="widget-mode-check">{mode === 'fixed' ? '✓' : '＄'}</span>
              <strong>Fixed USD amount</strong>
              <small>Set a dollar price for checkout</small>
            </button>
          </div>
          {mode === 'fixed' && <><label htmlFor="intentpay-fixed-amount">Fixed price (USD)</label><div className="widget-usd-input"><span>$</span><input id="intentpay-fixed-amount" type="number" min="0.01" step="0.01" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} placeholder="e.g. 25.00" /></div><p className="merchant-hint">Set the price in US dollars. XoDuspay converts it to the merchant payout token at the current listed USD price.</p></>}

          <div className="section-rule"><span>MERCHANT RECEIVES</span></div>
          <label htmlFor="intentpay-payout-chain">Payout network</label>
          <select id="intentpay-payout-chain" value={destinationChain} onChange={e => { setDestinationChain(e.target.value); setDestinationAsset(''); }}>
            <option value="">Choose payout network</option>
            {chains.map(chain => <option key={chain} value={chain}>{chain.toUpperCase()}</option>)}
          </select>
          {destinationChain ? <>
            <label htmlFor="intentpay-payout-token">Payout token on {destinationChain.toUpperCase()}</label>
            <select id="intentpay-payout-token" value={destinationAsset} onChange={e => setDestinationAsset(e.target.value)} disabled={payoutTokens.length === 0}>
              <option value="">{payoutTokens.length ? 'Choose a payout token' : 'No supported tokens on this network'}</option>
              {payoutTokens.map(t => <option key={t.assetId} value={t.assetId}>{t.symbol || 'TOKEN'}{t.name ? ' · ' + t.name : ''}</option>)}
            </select>
            {payoutTokens.length === 0 && <p className="merchant-error">No payout tokens are currently available for this network in the live NEAR Intents registry. Choose another network.</p>}
          </> : <p className="merchant-hint">Choose a payout network first. Only tokens supported on that network will appear here.</p>}
          <label htmlFor="intentpay-recipient">Your receiving wallet address</label>
          <input id="intentpay-recipient" value={recipient} onChange={e => setRecipient(isNearPayout ? e.target.value.toLowerCase().trim() : e.target.value.trim())} placeholder={isNearPayout ? 'merchant.near' : '0x…'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {recipient && selected && isNearPayout && nearAccountStatus === 'checking' && <p className="merchant-hint">Checking NEAR mainnet for this account…</p>}
          {recipient && selected && isNearPayout && nearAccountStatus === 'registered' && <p className="merchant-notice" role="status">✓ Registered NEAR account detected and verified on mainnet.</p>}
          {recipient && selected && isNearPayout && nearAccountStatus === 'unregistered' && <p className="merchant-error" role="alert">This NEAR account was not found on mainnet. Check the account ID.</p>}
          {recipient && selected && isNearPayout && nearAccountStatus === 'unavailable' && <p className="merchant-error" role="alert">Could not verify this account with NEAR mainnet. Try again shortly.</p>}
          {recipient && selected && isNearPayout && nearAccountStatus === 'idle' && !nearAccountFormatValid && <p className="merchant-error">Enter a valid lowercase NEAR account ID (2–64 characters).</p>}
          {recipient && selected && !isNearPayout && !addressValid && <p className="merchant-error">Enter a valid EVM wallet address for this payout network.</p>}

          <label htmlFor="intentpay-button-label">Button text</label>
          <input id="intentpay-button-label" value={buttonLabel} onChange={e => setButtonLabel(e.target.value)} maxLength={32} placeholder="Pay with crypto" />

          <div className="widget-preview">
            <span className="widget-preview-label">BUTTON PREVIEW</span>
            <button type="button" className="widget-preview-button" disabled={!ready || !buttonLabel.trim()} onClick={() => window.open(config, '_blank', 'noopener,noreferrer')}>{buttonLabel || 'Pay with crypto'} <span>↗</span></button>
            <small>{mode === 'fixed' ? ("Fixed price: $" + (fixedAmount || '—') + " USD" + (fixedTokenEstimate !== null ? " · approx. " + fixedTokenEstimate.toLocaleString(undefined, { maximumFractionDigits: 8 }) + " " + selected.symbol : "")) : "Customer chooses the payment amount"} · Preview opens checkout only; it does not pay.</small>
          </div>

          {ready && <>
            <label>Website embed code</label>
            <pre className="widget-code">{embed}</pre>
            <button type="button" className="primary" onClick={() => copy(embed, 'Embed code')}>Copy embed code</button>
            <label>Hosted checkout link</label>
            <div className="widget-direct-link"><code>{config}</code><button type="button" className="secondary" onClick={() => copy(config, 'Checkout link')}>Copy link</button></div>
            <div className="widget-qr-card">
              <div>
                <strong>Scan to pay</strong>
                <p>Customers can scan this QR code with their phone camera to open this exact checkout.</p>
              </div>
              {qrDataUrl ? <img className="widget-qr-image" src={qrDataUrl} alt="QR code for this XoDuspay checkout link" /> : <div className="widget-qr-placeholder">{qrError || 'Generating QR code…'}</div>}
              {qrDataUrl && <a className="widget-qr-download" href={qrDataUrl} download="xoduspay-checkout-qr.png">Download QR code</a>}
            </div>
          </>}
          {!ready && <p className="widget-setup-hint">Choose a payout network and token, enter your receiving wallet address, and complete the amount settings to generate your widget.</p>}

          <div className="section-rule"><span>PAYMENT RECEIPTS</span></div>
          <div className="merchant-receipts">
            <div className="merchant-receipts-head">
              <div><strong>Confirmed payments</strong><p className="merchant-hint">Receipts appear after NEAR Intents reports SUCCESS for a checkout created with this exact payout token and receiving address.</p></div>
              <button type="button" className="secondary" onClick={loadReceipts} disabled={!ready || receiptsLoading}>{receiptsLoading ? 'Refreshing…' : 'Refresh receipts'}</button>
            </div>
            {receiptsError && <p className="merchant-error" role="alert">{receiptsError}</p>}
            {!ready ? <p className="merchant-hint">Set your payout network, token and receiving address to view receipts for this merchant.</p> :
              receiptsLoading && receipts.length === 0 ? <p className="merchant-hint">Loading confirmed payments…</p> :
              receipts.length === 0 ? <p className="merchant-hint">No provider-confirmed payments yet. Keep this payout setup the same for receipts to appear here.</p> :
              <div className="merchant-receipts-list">{receipts.map(item => <article className="merchant-receipt" key={item.id}>
                <div className="merchant-receipt-top"><strong>{item.merchant || 'Merchant payment'}</strong><span className="history-status status-completed">COMPLETED</span></div>
                <div><strong>{item.payoutAmount || 'Amount not supplied'} </strong><span>{selected?.symbol || 'payout token'}</span></div>
                <small>{item.provider || 'Provider-confirmed'} · {item.completedAt ? new Date(item.completedAt).toLocaleString() : 'Completion time unavailable'}</small>
                {item.destinationTxHash && <small>Destination transaction: <code>{item.destinationTxHash.slice(0, 12)}…{item.destinationTxHash.slice(-8)}</code></small>}
                <small>Receipt reference: <code>{item.id.slice(0, 16)}</code></small>
              </article>)}</div>}
            <p className="merchant-hint">This ledger is read from XoDuspay's server storage, not from customer screenshots. A receipt is created only after the payment provider reports successful settlement. This initial ledger covers NEAR Intents / 1Click checkouts; LI.FI and direct-transfer receipts are not yet included.</p>
          </div>
          <p className="merchant-hint">The button opens XoDuspay's hosted mainnet checkout. Customers connect their own wallet, review the live NEAR Intents quote and network fee, then approve the payment. Your receiving address and payout asset are included in the public checkout link.</p>
          {error && <p className="merchant-error">{error}</p>}
          {notice && <p className="merchant-notice">{notice}</p>}
        </div>
        <div className="merchant-modal-foot">Powered by NEAR Intents · Mainnet only</div>
      </section>
    </div>
  );
}
