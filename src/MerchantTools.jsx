import { useMemo, useState } from 'react';

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

  const chainOf = t => String(t?.blockchain || '').trim().toLowerCase();
  const chains = useMemo(() => [...new Set(tokens.filter(t => t?.assetId && chainOf(t)).map(chainOf))].sort(), [tokens]);
  const payoutTokens = useMemo(() => tokens
    .filter(t => t?.assetId && destinationChain && chainOf(t) === destinationChain)
    .sort((a, b) => String(a.symbol || '').localeCompare(String(b.symbol || ''))), [tokens, destinationChain]);
  const selected = tokens.find(t => String(t.assetId) === String(destinationAsset) && chainOf(t) === destinationChain);
  const addressValid = selected?.blockchain?.toLowerCase() === 'near'
    ? /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(recipient.trim())
    : /^0x[a-fA-F0-9]{40}$/.test(recipient.trim());
  const ready = Boolean(selected && addressValid && (mode === 'variable' || (fixedAmount && Number(fixedAmount) > 0)));
  const config = useMemo(() => {
    if (!ready) return null;
    const params = new URLSearchParams({
      merchantAsset: destinationAsset,
      merchantRecipient: recipient.trim(),
      merchantName: merchantName.trim().slice(0, 80),
      ...(mode === 'fixed' ? { merchantAmount: fixedAmount } : {})
    });
    return window.location.origin + '/checkout?' + params.toString();
  }, [ready, destinationAsset, recipient, merchantName, mode, fixedAmount]);
  const embed = config
    ? '<button type="button" data-intentpay-checkout data-intentpay-url="' + config + '">' + buttonLabel.trim() + '</button>\\n<script src="' + window.location.origin + '/intentpay.js" defer></script>'
    : '';

  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setError(''); setNotice(label + ' copied.'); }
    catch { setNotice(''); setError('Clipboard access was blocked. Select and copy the value manually.'); }
  }

  if (!open && !page) return null;
  return (
    <div className={page ? "merchant-page-wrapper" : "merchant-overlay"} role="presentation" onMouseDown={event => { if (!page && event.target === event.currentTarget) onClose(); }}>
      <section className={page ? "merchant-modal merchant-page-card" : "merchant-modal"} role="dialog" aria-modal="true" aria-labelledby="merchant-title">
        <div className="merchant-modal-head">
          <div><div className="eyebrow">INTENTPAY · UNIVERSAL CHECKOUT</div><h2 id="merchant-title">{page ? 'Merchant workspace' : 'Checkout workspace'}</h2></div>
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
          <div className="widget-mode-switch">
            <button type="button" className={mode === 'variable' ? 'active' : ''} onClick={() => setMode('variable')}>Customer enters amount</button>
            <button type="button" className={mode === 'fixed' ? 'active' : ''} onClick={() => setMode('fixed')}>Fixed amount</button>
          </div>
          {mode === 'fixed' && <><label htmlFor="intentpay-fixed-amount">Amount customer must pay</label><input id="intentpay-fixed-amount" type="number" min="0.00000001" step="any" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} placeholder="e.g. 25.00" /></>}

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
          <input id="intentpay-recipient" value={recipient} onChange={e => setRecipient(e.target.value.trim())} placeholder={selected?.blockchain?.toLowerCase() === 'near' ? 'merchant.near' : '0x…'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          {recipient && selected && !addressValid && <p className="merchant-error">Enter a valid {selected.blockchain?.toLowerCase() === 'near' ? 'NEAR account ID' : 'EVM wallet address'} for this payout network.</p>}

          <label htmlFor="intentpay-button-label">Button text</label>
          <input id="intentpay-button-label" value={buttonLabel} onChange={e => setButtonLabel(e.target.value)} maxLength={32} placeholder="Pay with crypto" />

          <div className="widget-preview">
            <span className="widget-preview-label">BUTTON PREVIEW</span>
            <button type="button" className="widget-preview-button" disabled={!ready || !buttonLabel.trim()} onClick={() => window.open(config, '_blank', 'noopener,noreferrer')}>{buttonLabel || 'Pay with crypto'} <span>↗</span></button>
            <small>{mode === 'fixed' ? (fixedAmount || '—') + ' ' + (selected?.symbol || '') + ' · fixed-output checkout' : 'Customer chooses the payment amount'} · Preview opens checkout only; it does not pay.</small>
          </div>

          {ready && <>
            <label>Website embed code</label>
            <pre className="widget-code">{embed}</pre>
            <button type="button" className="primary" onClick={() => copy(embed, 'Embed code')}>Copy embed code</button>
            <label>Hosted checkout link</label>
            <div className="widget-direct-link"><code>{config}</code><button type="button" className="secondary" onClick={() => copy(config, 'Checkout link')}>Copy link</button></div>
          </>}
          {!ready && <p className="widget-setup-hint">Choose a payout network and token, enter your receiving wallet address, and complete the amount settings to generate your widget.</p>}
          <p className="merchant-hint">The button opens IntentPay's hosted mainnet checkout. Customers connect their own wallet, review the live NEAR Intents quote and network fee, then approve the payment. Your receiving address and payout asset are included in the public checkout link.</p>
          {error && <p className="merchant-error">{error}</p>}
          {notice && <p className="merchant-notice">{notice}</p>}
        </div>
        <div className="merchant-modal-foot">Powered by NEAR Intents · Mainnet only</div>
      </section>
    </div>
  );
}
