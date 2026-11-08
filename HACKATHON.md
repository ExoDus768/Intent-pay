# IntentPay — NEAR Intents Hackathon

## Project summary

IntentPay is a universal crypto checkout built around **NEAR Intents and the 1Click API**. Any merchant or app can publish a checkout button. Customers open a hosted checkout and pay from a supported wallet and network, while the merchant receives their configured payout asset at their receiving address.

The project is focused entirely on the universal checkout widget. Customers choose a supported payment asset and merchants receive their configured payout asset through the checkout flow.

## NEAR Intents integration

1. Load supported assets from the live 1Click token registry.
2. The merchant selects a payout network, token, recipient address and fixed or variable amount mode in the Merchant Workspace.
3. IntentPay generates a hosted checkout URL and embeddable button.
4. The customer opens checkout, selects a supported source network and token, and connects their wallet.
5. IntentPay requests a committed 1Click quote with a unique deposit address.
6. The customer reviews the amount, quote, fees and destination, then approves the deposit in their wallet.
7. IntentPay submits the confirmed deposit transaction where required and polls 1Click status.
8. Only 1Click `SUCCESS` confirms completed delivery.

The server keeps the 1Click JWT private. The browser never receives the API secret.

## Separate merchant and customer experiences

- **Merchant Workspace (`/merchant`)**: configure the checkout widget, payout network/token/address, fixed or variable amount, and copy the hosted checkout link or embed snippet.
- **Customer Checkout (`/checkout`)**: view the merchant's payment configuration, choose a source asset, connect a wallet, review the live quote and approve payment.


## Mainnet and wallet support

- NEAR Wallet Selector is configured for NEAR mainnet.
- EVM deposits use configured EVM mainnets.
- WalletConnect provides a QR/mobile connection path for supported EVM wallets.
- Assets are sourced from the live 1Click registry.
- The checkout has no testnet or simulated-payment mode. Wallet approvals move real assets.

## Demo flow

1. Open the IntentPay homepage.
2. Open the Merchant Workspace and configure a payout asset, receiving address and amount mode.
3. Copy the generated checkout link or embed snippet.
4. Open the hosted checkout as a customer.
5. Select a supported source network and token.
6. Connect an EVM or NEAR wallet.
7. Review the 1Click quote, destination amount, estimated time, deposit address and expiry.
8. Approve the payment in the wallet.
9. Wait for 1Click to report `SUCCESS`.

For a public demo, use a small amount and independently verify every wallet prompt and transaction on the relevant chain explorer.

## Configuration required

- `ONECLICK_JWT` — server-side 1Click mainnet credential.
- `VITE_WALLETCONNECT_PROJECT_ID` — public WalletConnect / Reown project ID.

See [README.md](./README.md) and [docs/checkout-widget.md](./docs/checkout-widget.md) for setup and integration notes.

## Small-payment fallback

If a 1Click route cannot quote a small EVM payment, checkout may offer a direct transfer only when the customer and merchant use the exact same ERC-20 token on the exact same EVM network. The backend checks the transaction on-chain (sender, token contract, recipient, exact amount, successful receipt and confirmations) before the UI records success. This fallback does not convert assets or bridge between chains; cross-chain payments remain a NEAR Intents / 1Click flow.

## Test status (mainnet)

- EVM wallet connection: user-tested successfully.
- Meteor Wallet in-app connection: user-tested successfully.
- Direct EVM same-token fallback: implemented; live payment verification still pending.
- NEAR customer → EVM merchant via NEAR Intents: implemented through the 1Click quote/deposit/status path; a successful live mainnet settlement has **not yet been verified**. Do not mark this path as tested until 1Click returns SUCCESS for a real transaction.
- NEAR wallet connection: tested by the user; full NEAR → EVM merchant settlement remains pending.

## Current limitations

- Merchant accounts and saved widget configurations are not implemented.
- Direct EVM fallback supports ERC-20 tokens only and only for an exact same-token, same-network payout.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- The app is a hackathon prototype, not an audited payment processor. Do not use it for high-value production payments without a full security review.
