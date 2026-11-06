# IntentPay

IntentPay is a NEAR Intents / 1Click cross-chain checkout prototype. A customer selects a supported EVM payment asset; the merchant selects a payout asset and destination address.

## Current implementation

- React + Vite checkout interface
- Live 1Click token registry (cached server-side for five minutes)
- Safe demo mode that simulates a checkout without calling 1Click or moving funds
- Merchant payout asset and recipient selection
- Server-side validation that both asset IDs exist in the live registry
- 1Click committed quote request with a unique deposit address
- EVM wallet connection and ERC-20 / native-token deposit transaction
- Network switching for configured EVM networks
- Transaction confirmation before deposit notification
- 1Click deposit submission and status polling
- Terminal status handling: SUCCESS, FAILED, REFUNDED, INCOMPLETE_DEPOSIT
- Server-side 1Click JWT; no secret in browser code
- Vercel serverless-compatible Express export

## Supported EVM wallet networks

The current wallet-send implementation maps these 1Click registry chain identifiers to EVM chain IDs: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Gnosis, Berachain, Scroll, and Aurora.

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

## Demo mode

The interface opens in Demo mode by default. It uses the live token list for the selectors but creates an illustrative quote locally; the displayed simulation never creates a real deposit address, signs a wallet transaction, or transfers funds. Use this mode for UI walkthroughs and hackathon demos.

Live payment mode is disabled until the server has a valid 1Click JWT configured.

## 1Click setup

Request a 1Click API key through the [NEAR Intents Partners Portal](https://partners.near-intents.org/). Add it to the server environment as `ONECLICK_JWT`.

The official 1Click service is mainnet. Quotes create real deposit addresses and sending a transaction moves real assets. Do not test with funds you cannot afford to lose. Start with a very small amount and verify the recipient, token, chain, quote expiry, and deposit address in the wallet before signing.

A community-built 1Click-compatible sandbox called Tidepool has been announced, but it is not the official 1Click service. Do not treat it as production infrastructure without independently checking its current availability and trust assumptions.

## Environment variables

- `ONECLICK_JWT`: server-only 1Click authentication token
- `ONECLICK_BASE_URL`: optional API base override; defaults to `https://1click.chaindefuser.com/v0`
- `APP_ORIGIN`: optional comma-separated allowed browser origins
- `PORT`: Express port (defaults to `3001`)

## Important limitations before production

This is a hackathon prototype, not an audited payment processor.

- The current checkout form collects merchant payout details at payment time. It does not yet create persistent merchant accounts, save checkout sessions, or issue shareable merchant payment links.
- EVM deposits are implemented for the mapped networks. NEAR wallet signing and NEP-141 transfers are not implemented yet.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- There is no persistent order database, webhook, reconciliation worker, merchant dashboard, or refund-management interface.
- The server validates asset IDs against the live token registry and validates the EVM refund address, but production deployment still needs stronger schema validation, abuse controls, rate limiting, monitoring, and security review.
- A failed notification after a confirmed on-chain deposit must be reconciled by checking the quote status. Do not send a second deposit for the same quote.
- Never treat a transaction broadcast as a completed payment. Only a 1Click `SUCCESS` status confirms destination delivery.

## Security

Never commit API secrets, wallet private keys, or seed phrases. Use your hosting provider's encrypted environment-variable settings. Do not accept customer payments until the full flow has been tested and independently reviewed.
