# IntentPay Universal Checkout Widget

IntentPay's widget lets a merchant place a checkout button on any website while keeping wallet connection, token selection, quote generation and payment approval on the hosted IntentPay checkout.

## 1. Create a payment request

1. Open the IntentPay merchant site.
2. Open **Merchant tools** and create an invoice with the payout network, payout token, exact amount and merchant wallet address.
3. Copy the invoice ID from the payment link. It is the value after `?invoice=`.

The invoice ID is a public checkout reference, not a password. Do not put API keys, wallet private keys or webhook secrets in browser code.

## 2. Add the button

Paste this where you want checkout to appear. Replace `YOUR_INVOICE_ID` with the ID from the payment link.

```html
<button type="button" data-intentpay-checkout data-intentpay-invoice="YOUR_INVOICE_ID">
  Pay with crypto
</button>
<script src="https://intent-pay-exo-c836.vercel.app/intentpay.js" defer></script>
```

The button opens the hosted IntentPay checkout in a separate window. If the browser blocks the popup, the customer is redirected to checkout in the current tab. This keeps wallet permissions and signing in the top-level IntentPay page rather than inside a third-party iframe.

## 3. Open checkout programmatically

```html
<button id="pay">Checkout</button>
<script src="https://intent-pay-exo-c836.vercel.app/intentpay.js" defer></script>
<script>
  document.getElementById('pay').addEventListener('click', function () {
    window.IntentPay.open({ invoiceId: 'YOUR_INVOICE_ID' });
  });
</script>
```

## 4. Listen for widget events

Buttons with `data-intentpay-checkout` emit `intentpay:open` after checkout is opened and `intentpay:error` if the invoice ID is missing or invalid.

```js
document.addEventListener('intentpay:open', function (event) {
  console.log('IntentPay checkout opened', event.detail.invoiceId);
});
document.addEventListener('intentpay:error', function (event) {
  console.error(event.detail.message);
});
```

## Current scope and important notes

- Checkout is hosted by IntentPay; merchants do not handle wallet keys or transaction signing.
- The customer can choose from the live assets and networks supported by the current 1Click token registry.
- The invoice fixes the merchant's payout asset, amount and recipient. The customer chooses the source asset/network in checkout.
- The checkout is mainnet-only. Customers must review the quote and network details before approving.
- This first widget release is a button/hosted-checkout launcher, not an iframe or a fully headless SDK.
- Payment completion must be determined from the invoice status or the configured signed webhook. A button click is not proof of payment.
- Merchant invoice storage currently requires the IntentPay server's Upstash Redis configuration.
