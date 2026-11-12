# XoDuspay

**Pay in the token you hold. Merchants receive the token they want.**

XoDuspay is a universal, cross-chain checkout built around **NEAR Intents 1Click**. Merchants configure the asset they want to receive; customers pay with a supported token and wallet they already hold. Merchants can share a hosted checkout link or QR code, or embed a checkout button on their website.

The customer reviews a live quote and approves the payment in their own wallet. XoDuspay tracks the payment and records it as complete only when NEAR Intents 1Click reports `SUCCESS`.

> **Status: mainnet hackathon prototype.** We have tested the currently enabled payment routes, including Robinhood Chain (Hood). BNB Smart Chain has been tested and works, but is flagged as unstable in the application. Mainnet payments move real assets. The project has not undergone an independent security audit.

## Table of contents

- [Project links](#project-links)
- [Mainnet transaction proof](#mainnet-transaction-proof)
- [How it works](#how-it-works)
- [Product capabilities](#product-capabilities)
- [Networks and route testing](#networks-and-route-testing)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [NEAR Intents setup](#near-intents-setup)
- [Payment status and reconciliation](#payment-status-and-reconciliation)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Tech stack](#tech-stack)

## Project links

| Resource | Link |
|---|---|
| Live application | https://xoduspay-exo-c836.vercel.app/ |
| Merchant workspace | https://xoduspay-exo-c836.vercel.app/merchant |
| Project on X | https://x.com/XoDuspay |
| NEAR Intents documentation | https://docs.near-intents.org |
| Hackathon overview | [HACKATHON.md](./HACKATHON.md) |
| Hackathon submission notes | [docs/HACKATHON-SUBMISSION.md](./docs/HACKATHON-SUBMISSION.md) |

## Mainnet transaction proof

**Mainnet test: 0.108 wNEAR (NEAR) → 0.004359503 SOL (Solana), settled via 1Click `SUCCESS`.**

- [View the NEAR source transaction on NearBlocks](https://nearblocks.io/txns/3QmPUVbKFdKDQvTSeXsqNdWwxLB4ctrZJhz6GeJVPMnF)
- [View the Solana destination transaction on Solscan](https://solscan.io/tx/332fhFGKxsvedfM8D85nvrnuBE4xmESUWTYCnGSX2xA39mvhhgcM2eP9q17dNvygM3GLSqq6D9UvZp6RtJDxEuNz)

## How it works

1. **Configure checkout.** The merchant selects a payout network and token, enters a receiving address, and chooses a fixed USD amount or customer-entered amount.
2. **Share checkout.** XoDuspay generates a hosted checkout link and QR code, with an embeddable website button.
3. **Connect wallet.** The customer connects a supported wallet, selects a source network and available token.
4. **Request quote.** The backend requests a NEAR Intents 1Click quote for the selected source asset, payout asset, amount and recipient.
5. **Review and approve.** The customer checks the quote, estimated output, minimum, expiry and deposit instructions, then approves in their wallet.
6. **Verify and track.** XoDuspay verifies the source transaction and tracks the 1Click quote status.
7. **Confirm settlement.** Only 1Click `SUCCESS` marks the payment complete. Wallet approval or transaction broadcast alone is not proof of completed delivery.

## Product capabilities

### Merchant checkout

- Merchant workspace at `/merchant`
- Payout network, token and receiving-address configuration
- Fixed-price checkout based on a USD amount or customer-entered amount
- Hosted checkout links and QR code generation
- Website checkout-button embed code and public `xoduspay.js` loader
- Merchant-selected payout asset independent of the customer's source asset

### Customer payment

- Hosted customer checkout at `/checkout`
- NEAR, EVM and Solana wallet flows
- Separate network and token selection
- Asset list sourced from the live NEAR Intents token registry
- Wallet balance detection for supported wallet/token combinations
- Live quote, expiry countdown and deposit instructions
- Source transaction verification and 1Click status tracking
- Terminal status handling for `SUCCESS`, `FAILED`, `REFUNDED` and `INCOMPLETE_DEPOSIT`
- Wallet-associated customer transaction history

### Backend and reliability

- NEAR Intents 1Click mainnet quote, deposit and status APIs
- Live token-registry validation with server-side metadata caching
- Server-side validation of asset IDs and payout/refund addresses
- Server-side 1Click JWT; the secret is not exposed in browser code
- NEAR RPC failover and Solana RPC proxy/failover
- EVM network switching and transaction confirmation handling
- API request validation and rate limits
- Wallet-signed authentication for customer history
- Optional private Vercel Blob storage for persistent history and replay-protection data
- Vercel-compatible Express backend

## Networks and route testing

XoDuspay uses the live 1Click token registry. An asset appearing in the registry does not guarantee that every source/destination pair or amount will receive a quote; availability depends on live liquidity, solver conditions and route minimums.

We have tested the currently enabled payment routes on mainnet, including the newly added Robinhood Chain (Hood) route. BNB Smart Chain is tested and working, but the application displays an **unstable** warning for it.

| Network | Project test status |
|---|---|
| NEAR | Mainnet payment flow tested |
| Solana | Wallet flow implemented; cross-chain settlement demonstrated |
| Ethereum | EVM payment flow tested |
| Base | EVM payment flow tested |
| Arbitrum | EVM payment flow tested |
| Optimism | EVM payment flow tested |
| Polygon | EVM payment flow tested |
| Avalanche | EVM payment flow tested |
| Gnosis | EVM payment flow tested |
| Berachain | EVM payment flow tested |
| Scroll | EVM payment flow tested |
| Aurora | EVM payment flow tested |
| BNB Smart Chain | Tested and working; flagged as unstable in the app |
| Robinhood Chain (Hood) | Newly added route tested successfully |

These are project integration-test results, not a security audit or a guarantee that every asset, wallet, amount or route will always be available.

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

The Vite client runs on port `5173`; the Express API runs on port `3001`. The Vite development server proxies API requests to Express.

Build the frontend:

```bash
npm run build
```

## Environment variables

Use the names defined by the repository's `.env.example` and configure secrets in your local environment and hosting provider.

| Variable | Purpose |
|---|---|
| `ONECLICK_JWT` | Server-side authentication token for NEAR Intents 1Click |
| `EXPLORER_JWT` | Explorer API JWT used for 1Click transaction lookup features |
| `XODUSPAY_HISTORY_SECRET` | Secret used to sign wallet-history sessions; use a random value of at least 32 characters |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for persistent private history and replay-protection storage |
| `APP_ORIGIN` | Optional comma-separated list of allowed browser origins |
| `PORT` | Express server port; defaults to `3001` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Public WalletConnect / Reown project ID used by browser wallet connections |

The `VITE_` variable is included in the browser bundle and must not contain a secret. **Never commit `.env`, API credentials, wallet private keys or seed phrases.**

## NEAR Intents setup

XoDuspay uses the NEAR Intents 1Click mainnet API. Request access through the [NEAR Intents Partners Portal](https://partners.near-intents.org/) and configure `ONECLICK_JWT` on the server.

The backend requests a dry quote to check route availability and input USD value before creating a committed quote and deposit address. If the quote is rejected or fails validation, a deposit address is not created.

## Payment status and reconciliation

**A broadcast transaction is not a completed payment.** Only 1Click `SUCCESS` confirms delivery to the merchant's destination.

| Situation | Recommended action |
|---|---|
| Wallet approval appears, but no transaction hash is returned | Check wallet activity and the relevant chain explorer before retrying. |
| Source transaction is confirmed, but 1Click is processing | Continue checking the same quote; do not create a second payment. |
| Deposit notification fails after an on-chain transfer | Reconcile the original deposit address with the 1Click status endpoint. Do not send a second deposit for that quote. |
| Quote expires before payment | Request a new quote and use its new deposit instructions. |
| 1Click reports failure or refund | Check the configured refund address and terminal quote status before retrying. |
| Quote is rejected or route unavailable | Do not send funds to an address from a rejected quote. Try another supported route or amount. |

## Troubleshooting

- **RPC error: `method not available`.** The selected RPC provider may not support the JSON-RPC method the app needs. Configure a provider that supports transaction lookup and the required methods; use the configured RPC fallback where available.
- **1Click quote returns HTTP 400.** The requested asset pair or amount may not be supported under current liquidity, solver availability or route minimums. Check the API response, confirm both asset IDs against the live token registry, and try a supported pair/amount. Do not assume a deposit address was created.
- **Wallet says approved, but no transaction hash appears.** Do not treat the payment as complete or immediately submit another payment. Check the wallet's activity and the source-chain explorer. If a transaction was broadcast, reconcile that transaction and the original 1Click quote before retrying.

## Security

- Customers approve transfers in their own wallets; XoDuspay does not hold customer private keys.
- Keep the 1Click JWT and other server credentials out of frontend code.
- Verify network, token, amount, recipient, quote expiry and deposit address before signing.
- Only 1Click terminal `SUCCESS` is treated as completed delivery.
- If the UI or notification fails after a deposit, reconcile the original quote before taking further action.
- Server-side validation and rate limits do not replace an independent security review.

## Known limitations

- XoDuspay is a hackathon prototype and has not undergone an independent security audit.
- BNB Smart Chain works but is flagged as unstable in the application.
- Quote availability, route minimums and settlement times depend on live 1Click liquidity and solver conditions.
- Merchant authentication and a full multi-merchant account-management system are not implemented; merchants configure checkout in the workspace.
- Customer history uses wallet-linked authentication and private cloud storage; cross-device recovery should be verified as part of production operations.
- There is no dedicated refund-management interface; refunds are handled through the 1Click flow and configured refund address.
- Production use requires monitoring, alerting, operational support and a security review.
- Embeds should be tested against each merchant's content security policy, popup behavior and mobile wallet handoff.

## Tech stack

- React and Vite
- Node.js and Express
- NEAR Intents 1Click
- NEAR Wallet Selector and NEAR RPC
- Ethers.js for EVM wallet and transaction flows
- Solana Web3.js and SPL Token libraries
- WalletConnect / Reown
- Vercel Functions and Vercel Blob

