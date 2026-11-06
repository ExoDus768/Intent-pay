# IntentPay — NEAR Intents Hackathon

## Project summary

IntentPay is a merchant checkout application built around **NEAR Intents and the 1Click API**. It lets a merchant request a payout in a selected supported asset while a customer pays from a different supported network and token.

The core project is the NEAR Intents payment flow. IntentPay does not implement its own bridge, solver, or cross-chain settlement system.

## Why it exists

Crypto merchants often need to accept several tokens across several networks. Customers may hold a different asset or use a different chain from the one the merchant wants to receive. IntentPay makes the checkout experience one flow while NEAR Intents coordinates the cross-chain execution.

## NEAR Intents integration

The application uses the official 1Click mainnet API:

1. Load supported assets from the live 1Click token registry.
2. Let the customer select an origin network and token.
3. Let the merchant select a supported payout network, token, and recipient.
4. Request a committed 1Click quote with a unique deposit address.
5. For fixed-price invoices, request an `EXACT_OUTPUT` quote so the merchant receives the exact invoice amount.
6. Ask the connected wallet to approve the origin-chain deposit.
7. Notify 1Click of the confirmed transaction where supported.
8. Read the 1Click status until it reaches a terminal state.
9. Treat only 1Click `SUCCESS` as confirmed merchant delivery; failed or refunded states are never shown as paid.

The server keeps the 1Click JWT private. The browser never receives the API secret.

## Mainnet and wallet support

- NEAR Wallet Selector is configured for NEAR mainnet.
- EVM deposits use configured EVM mainnets.
- WalletConnect provides a QR/mobile connection path for supported EVM wallets.
- Assets are sourced from the live 1Click registry rather than a hand-maintained token list.
- The checkout has no testnet or simulated-payment mode. Wallet approvals move real assets.

## Merchant experience

- Create fixed-output invoices with a payout asset and recipient.
- Share a payment URL or QR code.
- Review invoice status and paid / pending / failed counts in the merchant workspace.
- Optionally configure a signed HTTPS webhook for confirmed payment events.

Invoice records and webhook state use Upstash Redis. The dashboard stores the invoice IDs locally in the creating browser, so cross-device merchant account sync is not yet implemented.

## Demo flow

1. Open the IntentPay mainnet checkout.
2. Open **Merchant tools** and create an invoice for a supported payout asset.
3. Share or open the generated link.
4. Select a supported source network and token.
5. Connect an EVM or NEAR wallet.
6. Review the 1Click quote, exact merchant output, estimated time, deposit address, and expiry.
7. Approve the payment in the wallet.
8. Wait for 1Click to report `SUCCESS`.
9. Refresh the merchant dashboard to see the invoice status and webhook delivery result.

For a public demo, use a small amount and independently verify every wallet prompt and transaction on the relevant chain explorer.

## Configuration required

- `ONECLICK_JWT` — server-side 1Click mainnet credential.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — persistent invoice and webhook storage.
- `VITE_WALLETCONNECT_PROJECT_ID` — public WalletConnect / Reown project ID.

See [README.md](./README.md) for setup and security notes.

## Current limitations

- Merchant dashboard invoice IDs are saved in the browser that created them; merchant authentication and cross-device dashboard syncing remain future work.
- Webhook delivery is attempted when the checkout or dashboard checks payment status. A background reconciliation worker is still needed for guaranteed delivery if a customer closes the checkout.
- WalletConnect needs a project ID before its QR connection flow can be used.
- The app is a hackathon prototype, not an audited payment processor. Do not use it for high-value production payments without a full security review.
