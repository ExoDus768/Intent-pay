# XoDuspay

**Pay in the token you hold. Merchants receive the token they want.**

XoDuspay is a universal, cross-chain checkout built around **NEAR Intents 1Click**. It lets a merchant request payment in a preferred asset and receive that asset at a wallet on another supported blockchain, while the customer pays from a wallet and token they already hold.

A merchant can configure a checkout, share a hosted payment link or QR code, or embed a checkout button on a website. The customer connects a supported wallet, chooses an available payment asset, reviews a live quote, and approves the transaction in their own wallet. XoDuspay tracks the payment through settlement and records it as successful only after the 1Click status reports `SUCCESS`.

> **Project status: mainnet hackathon prototype.** The team has manually tested the currently enabled payment routes, including BNB Smart Chain and Robinhood Chain. BNB Smart Chain is working but is currently flagged in the product as unstable. Mainnet transactions move real assets. This prototype has not undergone an independent security audit.

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

The following explorer links were supplied by the project team as proof of a completed cross-chain checkout:

- **Solana destination transaction:** [View on Solscan](https://solscan.io/tx/332fhFGKxsvedfM8D85nvrnuBE4xmESUWTYCnGSX2xA39mvhhgcM2eP9q17dNvygM3GLSqq6D9UvZp6RtJDxEuNz)
- **NEAR source transaction:** [View on NearBlocks](https://nearblocks.io/txns/3QmPUVbKFdKDQvTSeXsqNdWwxLB4ctrZJhz6GeJVPMnF)

The demonstrated flow was a customer payment from NEAR using WNEAR, with the merchant receiving SOL on Solana. The team reported a successful 1Click settlement and independently checked the destination wallet.

## How it works

1. **Configure checkout.** The merchant selects a payout network and token, supplies the destination wallet address, and chooses either a fixed USD amount or customer-entered amount.
2. **Share the checkout.** XoDuspay generates a hosted checkout URL and QR code. Merchants can also use the website checkout-button embed.
3. **Connect a wallet.** The customer connects a supported NEAR, EVM or Solana wallet and chooses an available source network and token.
4. **Get a live quote.** The backend requests a quote from NEAR Intents 1Click using the selected source asset, merchant payout asset, amount and recipient.
5. **Review and approve.** The customer reviews the quote details, including the amount, estimated output, minimum, expiry and deposit instructions, then authorizes the payment in their own wallet.
6. **Verify and track.** XoDuspay verifies the source transaction, submits the deposit information to 1Click and polls the quote status.
7. **Confirm settlement.** The payment is marked complete only when 1Click returns `SUCCESS`. A wallet approval or transaction broadcast alone is not treated as a completed payment.

## Product capabilities

### Merchant checkout

- Dedicated merchant workspace at `/merchant`
- Configure payout network, token and receiving address
- Fixed-price checkout based on a USD amount
- Customer-entered amount checkout
- Hosted checkout links that carry the merchant payout details
- QR code generation for sharing or displaying at point of sale
- Website checkout-button embed code and the public `xoduspay.js` loader
- Merchant-selected payout asset, independent of the customer's source asset

### Customer payment

- Dedicated hosted customer checkout at `/checkout`
- Wallet connection for NEAR, EVM and Solana wallet flows
- Network selection separated from token selection
- Available assets sourced from the live NEAR Intents token registry
- Wallet balance detection for supported wallet and token combinations
- Live quote request and quote-expiry countdown
- Quote and deposit details shown before wallet approval
- Source transaction verification and 1Click deposit submission
- Settlement status tracking, including `SUCCESS`, `FAILED`, `REFUNDED` and `INCOMPLETE_DEPOSIT`
- Customer transaction history associated with a wallet-authenticated session

### Backend and reliability

- NEAR Intents 1Click mainnet quote, deposit and status APIs
- Live token registry validation; token metadata is cached server-side for five minutes
- Validation of source and destination asset IDs against the live registry
- Server-side validation of merchant payout and refund addresses
- Server-side 1Click JWT; the secret is not exposed in browser code
- NEAR RPC failover for transaction and account operations
- Solana RPC proxy/failover for browser wallet operations
- EVM network switching and transaction confirmation handling
- API rate limits and request validation
- Wallet-signed authentication for customer history
- Private Vercel Blob storage for persistent history and replay-protection data when configured
- Vercel-compatible Express backend

## Networks and route testing

XoDuspay uses the live NEAR Intents token registry to determine which assets can be quoted. Availability is pair- and liquidity-dependent: an asset appearing in the registry does not guarantee that every source/destination pair or amount will receive a quote.

The team reports that all currently enabled routes have been exercised successfully on mainnet. BNB Smart Chain has been tested and works, but is currently marked **unstable** in the application. Robinhood Chain (Hood) has also been added and tested successfully.

The application includes EVM network mappings for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Gnosis, Berachain, Scroll, Aurora and Robinhood Chain. The exact assets and available routes are determined by the live registry and the wallet flow enabled for that network.

| Network / wallet family | Current project status |
|---|---|
| NEAR | Mainnet wallet and NEP-141 payment flow implemented and tested |
| Solana | Wallet flow implemented; cross-chain settlement demonstrated |
| Ethereum | EVM wallet payment flow implemented and tested |
| Base | EVM wallet payment flow implemented and tested |
| Arbitrum | EVM wallet payment flow implemented and tested |
| Optimism | EVM wallet payment flow implemented and tested |
| Polygon | EVM wallet payment flow implemented and tested |
| Avalanche | EVM wallet payment flow implemented and tested |
| Gnosis | EVM wallet payment flow implemented and tested |
| Berachain | EVM wallet payment flow implemented and tested |
| Scroll | EVM wallet payment flow implemented and tested |
| Aurora | EVM wallet payment flow implemented and tested |
| BNB Smart Chain | Tested and working; **unstable warning is shown in the app** |
| Robinhood Chain (Hood) | Newly added route tested successfully |

These statuses describe the team's integration testing, not a security audit or a guarantee that every token, wallet, amount or route will always be available. Live liquidity, solver availability, token support, network conditions and route minimums can change.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

The Vite client runs on port `5173`; the Express API runs on port `3001`. The Vite development server proxies API requests to Express.

Build the frontend with:

```bash
npm run build
```

## Environment variables

The repository's `.env.example` defines the primary local settings. The backend also reads the optional/production variables listed below.

| Variable | Purpose |
|---|---|
| `ONECLICK_JWT` | Server-side authentication token for NEAR Intents 1Click |
| `EXPLORER_JWT` | Explorer API JWT used for 1Click transaction lookup features |
| `XODUSPAY_HISTORY_SECRET` | Secret used to sign wallet-history sessions; use a random value of at least 32 characters |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for persistent private history and challenge replay-protection storage |
| `APP_ORIGIN` | Optional comma-separated list of allowed browser origins |
| `PORT` | Express server port; defaults to `3001` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Public WalletConnect / Reown project ID used by browser wallet connections |

Set server secrets in your local `.env` file and your hosting provider's encrypted environment settings. The `VITE_` variable is bundled for browser use and must not contain a secret.

**Never commit `.env`, API credentials, wallet private keys or seed phrases.**

## NEAR Intents setup

XoDuspay uses the NEAR Intents 1Click mainnet API. Request access through the [NEAR Intents Partners Portal](https://partners.near-intents.org/) and configure `ONECLICK_JWT` in the server environment.

The backend requests a dry quote to check the route and authoritative input USD value before creating a committed quote and deposit address. It does not create a deposit address when the quote is rejected or fails validation.

## Payment status and reconciliation

**A broadcast transaction is not a completed payment.** Only a 1Click `SUCCESS` status confirms delivery to the merchant's destination.

| Situation | Recommended action |
|---|---|
| Wallet approval appears, but the app has no transaction hash | Check wallet activity and the relevant chain explorer before retrying. |
| Source transaction is confirmed, but 1Click is still processing | Keep checking the same quote's status; do not create a second payment. |
| Deposit notification fails after an on-chain transfer | Reconcile using the original deposit address and 1Click status endpoint. Do not send a second deposit for that quote. |
| Quote expires before payment | Request a fresh quote and review its new deposit instructions. |
| 1Click reports a failed or refunded payment | Check the configured refund address and the quote's terminal status before trying again. |
| A quote is rejected or a route is unavailable | No deposit address should be used; try another available route or amount if appropriate. |

A route can be rejected because of liquidity, solver availability, supported asset pairs or provider minimums. Minimums are route-specific and can change; XoDuspay does not guarantee that every amount or pair will be accepted.

## Security and operational notes

- Customers retain control of their funds and approve transfers from their own wallets. XoDuspay does not custody customer private keys.
- The 1Click authentication token is used server-side and must never be exposed in frontend code.
- Confirm the network, token, amount, recipient, quote expiry and deposit address in the wallet before signing.
- Only the 1Click terminal `SUCCESS` status is treated as completed delivery.
- A failed notification or frontend interruption does not prove that a deposit failed; reconcile the original quote before taking another action.
- The prototype uses server-side validation, rate limits and wallet-signed history authentication, but these controls do not replace an independent security review.

## Known limitations

- XoDuspay is a hackathon prototype and has not undergone an independent security audit.
- BNB Smart Chain is working but currently flagged as unstable in the application.
- Quote availability, route minimums and settlement times depend on live 1Click liquidity and solver conditions.
- Merchant authentication and a full multi-merchant account-management system are not implemented; merchants configure checkout in the workspace.
- Customer history uses wallet-linked authentication and private cloud storage; production operations should verify cross-device recovery and retention behavior.
- There is no dedicated refund-management interface; refunds are handled through the 1Click flow and the configured refund address.
- Production use requires monitoring, alerting, operational support and a security review.
- The checkout embed should be tested against each merchant's content security policy, popup behavior and mobile wallet handoff.

## Tech stack

- React and Vite
- Node.js and Express
- NEAR Intents 1Click
- NEAR Wallet Selector and NEAR RPC
- Ethers.js for EVM wallet and transaction flows
- Solana Web3.js and SPL Token libraries
- WalletConnect / Reown
- Vercel Functions and Vercel Blob

## License

No license has been declared in this repository yet. All rights remain with the project authors unless and until a license is added.
