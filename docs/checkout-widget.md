# XoDuspay Universal Checkout Widget

XoDuspay provides a reusable checkout button for merchants and apps. Customers open a hosted checkout, connect a supported mainnet wallet, review a live NEAR Intents quote and approve the payment themselves.

## Configure the widget

Open the **Merchant workspace** from the top-left navigation. Set:
- Your payout network, token and receiving wallet address.
- **Customer enters amount** for variable payments, or **Fixed amount** for a fixed-price checkout.
- Optional business/payment name and button label.

Copy the generated embed snippet or hosted checkout link.

## Add the button to a website

Paste the generated snippet into your page:

```html
<button type="button" data-xoduspay-checkout data-xoduspay-url="YOUR_GENERATED_CHECKOUT_URL">Pay with crypto</button>
<script src="https://xoduspay-exo-c836.vercel.app/xoduspay.js" defer></script>
```

The generated URL contains the selected payout asset and public receiving address. A fixed-price widget also includes its payout amount. Treat the link as public: do not put private keys, API credentials or secrets in it.

## Open checkout programmatically

```js
window.XoDuspay.open({
  merchantAsset: 'LIVE_1CLICK_ASSET_ID',
  merchantRecipient: 'MERCHANT_WALLET_ADDRESS',
  amount: '25.00', // optional; omit for customer-entered amount
  merchantName: 'Your Store'
});
```

You can also pass a generated same-origin checkout URL:

```js
window.XoDuspay.open({ url: 'YOUR_GENERATED_CHECKOUT_URL' });
```

## Events

The widget emits `xoduspay:open` after opening hosted checkout and `xoduspay:error` if its configuration is invalid.

```js
document.addEventListener('xoduspay:open', event => console.log('Checkout opened', event.detail));
document.addEventListener('xoduspay:error', event => console.error(event.detail.message));
```

## Payment safety and status

- The widget opens hosted checkout; it does not initiate a wallet transaction on button click.
- Customers choose their source asset/network, connect their wallet, review the live quote, amount and network gas, then explicitly approve.
- Variable mode uses an exact-input quote. Fixed mode uses an exact-output quote so the merchant's configured payout amount is targeted.
- Mainnet only. The minimum quote is $0.01 USD equivalent, checked against the live 1Click quote.
- Payment status is confirmed from the 1Click status response. A button click or transaction submission alone is not proof of completed settlement.
- The merchant payout asset and receiving address are public checkout configuration. Validate that the address belongs to your business before publishing the link.
