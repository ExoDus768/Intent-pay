# IntentPay

IntentPay is a NEAR Intents / 1Click cross-chain checkout prototype. A customer selects a supported EVM or NEAR payment asset; the merchant selects a payout asset and destination address.

## Current implementation

- React + Vite checkout interface
- Live 1Click token registry (cached server-side for five minutes)
- Merchant payout asset and recipient selection
- Server-side validation that both asset IDs exist in the live registry
- 1Click committed quote request with a unique deposit address
- EVM wallet connection and ERC-20 / native-token deposit transaction
- NEAR Wallet Selector connection and NEP-141 deposits
- Native NEAR wrapping to wNEAR before sending to a 1Click deposit address
- NEAR sender account included in 1Click deposit notifications
- Network switching for configured EVM networks
- Transaction confirmation before deposit notification
- 1Click deposit submission and status polling
- Terminal status handling: SUCCESS, FAILED, REFUNDED, INCOMPLETE_DEPOSIT
- Server-side 1Click JWT; no secret in browser code
- Vercel serverless-compatible Express export
- Fixed-output merchant invoices using 1Click `EXACT_OUTPUT`
- Shareable invoice links and QR codes
- Merchant invoice dashboard with paid / pending / failed counts
- Persistent invoice records through Upstash Redis REST
- Optional signed merchant webhooks after 1Click confirms `SUCCESS`
- WalletConnect QR / mobile wallet connection for EVM networks
- Browser payment-completion notifications
- 1Click estimated settlement-time display

## Supported wallet networks

NEAR mainnet deposits are supported through NEAR Wallet Selector for NEP-141 assets listed by the live registry, including wrapped NEAR. Native NEAR is wrapped to wNEAR in the wallet transaction before transfer.

## Supported EVM wallet networks

The EVM wallet-send implementation maps these 1Click registry chain identifiers to EVM chain IDs: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Gnosis, Berachain, Scroll, and Aurora.

The live token list can include other chains. Their assets may appear as payout choices, but the browser deposit flow is not enabled for every chain yet. Unsupported origin networks must not be used to send a deposit.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Set `ONECLICK_JWT` in `.env` before requesting a quote. Keep the JWT server-side. Never expose it in browser code or commit a real secret.

The Vite frontend runs on port 5173 and proxies `/api` requests to Express on port 3001.

## 1Click setup

Request a 1Click API key through the [NEAR Intents Partners Portal](https://partners.near-intents.org/). Add it to the server environment as `ONECLICK_JWT`.

IntentPay is pinned to the official NEAR Intents 1Click mainnet endpoint. NEAR Wallet Selector is configured for NEAR mainnet, and EVM deposits use the corresponding EVM mainnets. The app has no testnet or simulated-payment checkout mode. Quotes create real deposit addresses and sending a transaction moves real assets. Before enabling customer payments, test with a tiny amount you can afford to lose and independently verify the token, chain, amount, recipient, quote expiry, and deposit address.

## Environment variables

- `ONECLICK_JWT`: server-only 1Click authentication token
- `APP_ORIGIN`: optional comma-separated allowed browser origins
- `PORT`: Express port (defaults to `3001`)
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST endpoint for invoice records and webhook state
- `UPSTASH_REDIS_REST_TOKEN`: server-only Upstash Redis REST token
- `VITE_WALLETCONNECT_PROJECT_ID`: public WalletConnect / Reown project ID used by the browser bundle

Create an Upstash Redis database and add its REST URL and token to Vercel as server environment variables. Add the WalletConnect project ID as a Vercel environment variable with the `VITE_` prefix, then redeploy. Do not expose the Upstash token to the browser.

## Merchant invoices and webhooks

The merchant workspace creates a persistent invoice record from a live 1Click payout asset. The link opens a fixed-output checkout: the customer chooses a supported origin asset and 1Click quotes the exact destination amount with `EXACT_OUTPUT`. A QR code is generated for the same link.

Invoice IDs are saved in the merchant browser's local storage for the dashboard list. Invoice records and settlement status are stored server-side in Upstash Redis. The dashboard list is device-local; moving to another browser requires saving the invoice links or IDs.

Optional webhooks are delivered when the checkout status endpoint observes a 1Click `SUCCESS`. The request includes `X-IntentPay-Event` and an `X-IntentPay-Signature` header. Verify the signature as HMAC-SHA256 over the raw request body using the per-invoice webhook secret shown once when the invoice is created. Only public HTTPS webhook hosts are accepted. The dashboard can retry a failed delivery after success.

For uninterrupted webhook delivery after a customer closes the checkout page, add a background reconciliation worker or scheduled job before production launch. The current Vercel function flow updates the invoice and attempts delivery when status is checked; it is not a continuously running worker.

## Important limitations before production

This is a hackathon prototype, not an audited payment processor.

- The current checkout form collects merchant payout details at payment time. It does not yet create persistent merchant accounts, save checkout sessions, or issue shareable merchant payment links.
- NEAR deposits use NEAR mainnet and the MyNearWallet wallet-selector module. The NEAR-origin flow supports registry-listed NEP-141 contracts and wraps native NEAR to wNEAR before transfer. This path has not yet been end-to-end tested with a live 1Click quote.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- The merchant dashboard's saved invoice list is local to the browser; merchant account authentication and cross-device dashboard syncing are not yet implemented.
- Webhook delivery is triggered when a payment status is checked. A background reconciliation worker is still required for guaranteed delivery if a customer closes the checkout page.
- There is no refund-management interface.
- The server validates asset IDs against the live token registry, validates EVM refund addresses, rate-limits invoice creation per IP, and rejects webhook URLs that do not resolve to public HTTPS hosts. Production still needs merchant authentication, stronger webhook egress controls, monitoring, and security review.
- A failed notification after a confirmed on-chain deposit must be reconciled by checking the quote status. Do not send a second deposit for the same quote.
- Never treat a transaction broadcast as a completed payment. Only a 1Click `SUCCESS` status confirms destination delivery.

## Security

Never commit API secrets, wallet private keys, or seed phrases. Use your hosting provider's encrypted environment-variable settings. Do not accept customer payments until the full flow has been tested and independently reviewed.
