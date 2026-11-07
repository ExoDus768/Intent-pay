import { useState } from 'react';

const X_URL = 'https://x.com/Intent_Payy';
const MERCHANT_URL = '/merchant';

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="landing-shell">
    <header className="landing-nav">
      <div className="landing-menu-wrap">
        <button className="landing-menu-button" type="button" aria-label="Open main menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>
          <span></span><span></span><span></span>
        </button>
        {menuOpen && <div className="landing-menu">
          <a className="landing-menu-primary" href={MERCHANT_URL}>Merchant workspace <span>↗</span></a>
          <a href="#technology" onClick={() => setMenuOpen(false)}>The technology</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="https://github.com/ExoDus768/Intent-pay#readme" target="_blank" rel="noreferrer">Documentation ↗</a>
          <a href="https://github.com/ExoDus768/Intent-pay" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href={X_URL} target="_blank" rel="noreferrer">Follow us on X ↗</a>
        </div>}
      </div>
      <a className="landing-brand" href="/" aria-label="IntentPay home"><span className="landing-brand-mark">I</span><span>IntentPay</span></a>
      <a className="landing-nav-cta" href={MERCHANT_URL}>Open workspace <span>↗</span></a>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <div className="landing-eyebrow"><span></span> UNIVERSAL CRYPTO CHECKOUT · POWERED BY NEAR INTENTS</div>
        <h1>One checkout.<br/><em>More ways to pay.</em></h1>
        <p>Let customers pay with the crypto they already hold. IntentPay gives merchants one simple checkout experience, while NEAR Intents handles the route to the asset you want to receive.</p>
        <div className="landing-hero-actions"><a className="landing-primary-cta" href={MERCHANT_URL}>Get started <span>↗</span></a><a className="landing-text-cta" href="#technology">Explore the technology <span>↓</span></a></div>
        <div className="landing-proofline"><span className="landing-proof-dot"></span> Built for merchants and apps · Non-custodial wallet approval</div>
      </div>
      <div className="landing-visual" aria-label="Illustration of a universal crypto checkout flow">
        <div className="landing-glow"></div>
        <div className="landing-visual-top"><span>INTENTPAY CHECKOUT</span><span className="landing-live-dot">● READY</span></div>
        <div className="landing-payment-card">
          <div className="landing-payment-brand"><span className="landing-mini-mark">I</span><span>Merchant checkout</span><span className="landing-lock">⌑</span></div>
          <div className="landing-amount-label">YOU PAY WITH</div>
          <div className="landing-token-choice"><span className="landing-token-icon">Ξ</span><span><strong>Your crypto</strong><small>Choose a supported asset</small></span><span className="landing-chevron">⌄</span></div>
          <div className="landing-route-line"><span></span><i>↓</i><span></span></div>
          <div className="landing-amount-label">MERCHANT RECEIVES</div>
          <div className="landing-token-choice landing-receive"><span className="landing-token-icon landing-token-green">✓</span><span><strong>Preferred payout</strong><small>Merchant-selected asset</small></span><span className="landing-check">✓</span></div>
          <div className="landing-quote-note"><span>✦</span> A route is quoted before you approve payment.</div>
          <div className="landing-pay-preview">Continue to payment <span>↗</span></div>
        </div>
        <div className="landing-float-tag landing-tag-top"><span>↗</span> Any supported wallet</div>
        <div className="landing-float-tag landing-tag-bottom"><span>✓</span> One merchant checkout</div>
      </div>
    </section>

    <section className="landing-strip"><div><strong>ONE INTEGRATION</strong><span>for your checkout flow</span></div><i></i><div><strong>CHOICE OF ASSETS</strong><span>for your customers</span></div><i></i><div><strong>YOUR PAYOUT</strong><span>configured by the merchant</span></div></section>

    <section className="landing-section" id="technology">
      <div className="landing-section-heading"><div className="landing-eyebrow">THE TECHNOLOGY</div><h2>Checkout that works<br/><em>across crypto.</em></h2><p>Crypto payments can feel complicated when customers and merchants use different assets. IntentPay puts a simpler experience in front of that complexity.</p></div>
      <div className="landing-feature-grid">
        <article className="landing-feature-card landing-feature-main"><div className="landing-feature-icon">✳</div><div className="landing-feature-kicker">01 / UNIVERSAL CHECKOUT</div><h3>One button.<br/>A flexible way to pay.</h3><p>Merchants create a checkout link, QR code or embeddable button. Customers open the checkout and choose from supported payment assets.</p><span className="landing-feature-arrow">↗</span></article>
        <article className="landing-feature-card"><div className="landing-feature-icon">⌁</div><div className="landing-feature-kicker">02 / NEAR INTENTS</div><h3>Let the intent find the route.</h3><p>IntentPay uses NEAR Intents and 1Click to request a quote for converting a customer's chosen asset into the merchant's configured payout asset.</p><span className="landing-feature-arrow">↗</span></article>
        <article className="landing-feature-card"><div className="landing-feature-icon">◈</div><div className="landing-feature-kicker">03 / MERCHANT CONTROL</div><h3>Set how your business gets paid.</h3><p>Choose the payout network, token and receiving address. Use a fixed amount or let customers enter the amount at checkout.</p><span className="landing-feature-arrow">↗</span></article>
      </div>
    </section>

    <section className="landing-how" id="how-it-works"><div className="landing-how-heading"><div className="landing-eyebrow">HOW IT WORKS</div><h2>From checkout to<br/><em>payment, simply.</em></h2></div><div className="landing-steps"><article><span>01</span><h3>Merchant sets up</h3><p>Configure your receiving token and address, then create a checkout link, QR code or widget.</p></article><article><span>02</span><h3>Customer chooses</h3><p>The customer opens checkout, connects a supported wallet and selects an available asset.</p></article><article><span>03</span><h3>IntentPay gets a quote</h3><p>NEAR Intents provides a route quote so the customer can review the payment before approving it.</p></article><article><span>04</span><h3>Payment is delivered</h3><p>The customer approves the transaction in their wallet and can track the payment status.</p></article></div></section>

    <section className="landing-cta-panel"><div><div className="landing-eyebrow">BUILT FOR THE NEXT PAYMENT EXPERIENCE</div><h2>Make crypto checkout<br/><em>feel like checkout.</em></h2><p>Start with your merchant workspace and create your first IntentPay checkout.</p></div><a className="landing-primary-cta" href={MERCHANT_URL}>Open merchant workspace <span>↗</span></a></section>

    <footer className="landing-footer"><a className="landing-brand" href="/"><span className="landing-brand-mark">I</span><span>IntentPay</span></a><p>Universal crypto checkout powered by NEAR Intents.</p><div className="landing-footer-links"><a href={X_URL} target="_blank" rel="noreferrer">Follow us on X ↗</a><a href="https://github.com/ExoDus768/Intent-pay" target="_blank" rel="noreferrer">GitHub ↗</a><a href={MERCHANT_URL}>Merchant workspace ↗</a></div><small>© {new Date().getFullYear()} IntentPay. Built for open crypto payments.</small></footer>
  </main>;
}
