# IntentPay

See [HACKATHON.md](./HACKATHON.md) for the NEAR Intents hackathon project summary and demo flow.

IntentPay is a universal crypto checkout built with NEAR Intents and the 1Click API. Merchants configure a payout asset and receiving address; customers pay from supported wallets and assets through one hosted checkout.

## Current implementation

- React + Vite checkout interface
- Live 1Click token registry (cached server-side for five minutes)
- Merchant payout asset and recipient selection
- Server-side validation that both asset IDs exist in the live registry
- NEAR Intents committed payment quote with a unique deposit address
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
- `VITE_WALLETCONNECT_PROJECT_ID`: public WalletConnect / Reown project ID used by the browser bundle

Add the WalletConnect project ID as a Vercel environment variable with the `VITE_` prefix, then redeploy.

## Important limitations before production

This is a hackathon prototype, not an audited payment processor.

- Merchant workspace settings generate a public hosted checkout URL and embeddable button. Merchant accounts, saved configurations and payment history are not implemented.
- NEAR deposits use NEAR mainnet and the MyNearWallet wallet-selector module. The NEAR-origin flow supports registry-listed NEP-141 contracts and wraps native NEAR to wNEAR before transfer. This path has not yet been end-to-end tested with a live 1Click quote.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- There is no refund-management interface.
- The server validates asset IDs against the live token registry and validates payout/refund addresses. Production still needs merchant authentication, monitoring, and security review.
- A failed notification after a confirmed on-chain deposit must be reconciled by checking the quote status. Do not send a second deposit for the same quote.
- Never treat a transaction broadcast as a completed payment. Only a 1Click `SUCCESS` status confirms destination delivery.

## Security

Never commit API secrets, wallet private keys, or seed phrases. Use your hosting provider's encrypted environment-variable settings. Do not accept customer payments until the full flow has been tested and independently reviewed.
