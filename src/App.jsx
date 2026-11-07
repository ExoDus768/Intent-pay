import { useMemo, useState } from 'react';

export default function App() {
  const [mode, setMode] = useState('send');
  const [username, setUsername] = useState('');
  const [amount, setAmount] = useState('');
  const normalizedUsername = useMemo(() => username.trim().replace(/^@/, '').toLowerCase(), [username]);

  return (
    <div className="social-shell">
      <nav className="social-nav">
        <a className="social-brand" href="/"><span className="social-brand-mark">I</span> IntentPay</a>
        <a href="/merchant">Merchant checkout ↗</a>
      </nav>
      <main className="social-main">
        <div className="social-kicker">INTENTPAY SOCIAL PAY</div>
        <h1>Send crypto to an X username.</h1>
        <p className="social-lead">A simpler way to send value to someone on X. The recipient will verify their X account before claiming a payment.</p>
        <section className="social-card">
          <div className="social-tabs" role="tablist" aria-label="Social Pay mode">
            <button type="button" role="tab" aria-selected={mode === 'send'} className={mode === 'send' ? 'active' : ''} onClick={() => setMode('send')}>Send</button>
            <button type="button" role="tab" aria-selected={mode === 'claim'} className={mode === 'claim' ? 'active' : ''} onClick={() => setMode('claim')}>Claim</button>
          </div>
          {mode === 'send' ? (
            <div className="social-form">
              <label>RECIPIENT'S X USERNAME
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="@username" autoComplete="off" />
                <span className="social-field-note">{normalizedUsername ? 'Account lookup will ignore capital letters: @' + normalizedUsername : 'Example: @exodus'}</span>
              </label>
              <label>AMOUNT (USD VALUE)
                <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
                <span className="social-field-note">Choose your network and token after wallet and route support are ready.</span>
              </label>
              <button className="social-disabled" type="button" disabled>Sending will be enabled after secure escrow is deployed</button>
            </div>
          ) : (
            <div className="social-form">
              <label>YOUR X USERNAME
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="@username" autoComplete="off" />
                <span className="social-field-note">{normalizedUsername ? 'Matching will be case-insensitive: @' + normalizedUsername : 'Sign in with the X account that received the payment.'}</span>
              </label>
              <button className="social-disabled" type="button" disabled>Claiming will be enabled after X verification is connected</button>
            </div>
          )}
          <div className="social-guard"><span>◆</span><div><strong>Mainnet safety is on.</strong> Social Pay is a preview only. No wallet will be charged and no claim can be made from this page yet.</div></div>
        </section>
        <p className="social-note">Planned: case-insensitive X identity matching, one-time claims, recipient-selected payout options, and an expiry/refund path. Payments will only open once the escrow and identity checks are implemented and audited.</p>
      </main>
      <footer className="social-footer">IntentPay · Powered by NEAR Intents</footer>
    </div>
  );
}
