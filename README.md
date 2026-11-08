# XoDuspay

**Universal crypto checkout powered by NEAR Intents and the 1Click API.**

XoDuspay gives merchants one checkout flow they can share as a hosted link, QR code or website button. Customers choose from supported payment assets and connect their own wallet. The merchant configures the payout network, token and receiving address.

## Start here

- **Public landing page:** https://intent-pay-eta.vercel.app/
- **Merchant workspace:** https://intent-pay-eta.vercel.app/merchant
- **Project on X:** https://x.com/Intent_Payy
- **Hackathon overview:** [HACKATHON.md](./HACKATHON.md)

## How it works

1. A merchant selects a payout network and token, enters a receiving address, and chooses a fixed or customer-entered amount.
2. XoDuspay creates a hosted checkout link, a scannable QR code and website button embed code.
3. The customer opens checkout, selects an available payment asset and connects a supported wallet.
4. XoDuspay requests a committed quote from NEAR Intents 1Click.
5. The customer reviews the quote and approves the deposit in their own wallet.
6. XoDuspay tracks the 1Click status. Only SUCCESS confirms completed delivery.

## Current implementation

- Public landing page describing the Universal Checkout Widget and NEAR Intents technology
- Separate merchant workspace (/merchant) and customer checkout (/checkout)
- Live 1Click token registry, cached server-side for five minutes
- Merchant payout network, token and receiving-address configuration
- Fixed-price and customer-entered amount checkout modes
- Hosted checkout URL generation
- QR code generation and PNG download
- Website button embed code and the public/xoduspay.js checkout loader
- Server-side validation that payout and payment asset IDs exist in the live registry
- NEAR Intents committed payment quotes with unique deposit addresses
- EVM wallet connection and ERC-20 / native-token deposit transactions
- NEAR Wallet Selector connection and NEP-141 deposits
- Native NEAR wrapping to wNEAR before sending to a 1Click deposit address
- NEAR sender account included in 1Click deposit notifications
- Network switching for configured EVM networks
- Transaction confirmation before deposit notification
- 1Click deposit submission and payment-status polling
- Terminal status handling: SUCCESS, FAILED, REFUNDED, INCOMPLETE_DEPOSIT
- Server-side 1Click JWT; no API secret in browser code
- Vercel serverless-compatible Express export
- WalletConnect QR / mobile wallet connection for EVM networks
- Browser payment-completion notifications
- 1Click estimated settlement-time display
- Wallet-linked customer transaction history with private cloud storage; cross-device behavior still requires end-to-end testing

## Supported wallet networks

NEAR mainnet deposits are supported through NEAR Wallet Selector for NEP-141 assets listed by the live registry, including wrapped NEAR. Native NEAR is wrapped to wNEAR in the wallet transaction before transfer.

The EVM wallet-send implementation maps these 1Click registry chain identifiers to EVM chain IDs: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche, Gnosis, Berachain, Scroll and Aurora.

The live token list can include assets on other chains. Those assets may appear as payout choices, but browser deposit support is not enabled for every network. Do not send from an origin network unless the checkout explicitly supports its wallet flow.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Set ONECLICK_JWT in .env before requesting a quote. Keep the JWT server-side. Never expose it in browser code or commit a real secret.

The Vite frontend runs on port 5173 and proxies /api requests to Express on port 3001.

## 1Click setup

Request a 1Click API key through the [NEAR Intents Partners Portal](https://partners.near-intents.org/). Add it to the server environment as ONECLICK_JWT.

XoDuspay uses the official NEAR Intents 1Click mainnet endpoint. NEAR Wallet Selector is configured for NEAR mainnet, and EVM deposits use the corresponding EVM mainnets. There is no testnet or simulated-payment checkout mode. Quotes create real deposit addresses and sending a transaction moves real assets. Before enabling customer payments, test with a tiny amount you can afford to lose and independently verify the token, chain, amount, recipient, quote expiry and deposit address.

## Environment variables

- ONECLICK_JWT: server-only 1Click authentication token
- APP_ORIGIN: optional comma-separated allowed browser origins
- PORT: Express port (defaults to 3001)
- VITE_WALLETCONNECT_PROJECT_ID: public WalletConnect / Reown project ID used by the browser bundle

Add the WalletConnect project ID as a Vercel environment variable with the VITE_ prefix, then redeploy.

## Current limitations

XoDuspay is a hackathon prototype, not an audited payment processor.

- Merchant accounts and saved widget configurations are not implemented; merchants currently configure the widget in the workspace.
- Customer transaction history uses wallet-linked private cloud storage, but two-device synchronization has not yet been end-to-end verified.
- The NEAR deposit path uses NEAR mainnet and the MyNearWallet wallet-selector module. It still requires end-to-end verification with a live 1Click quote.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- The embed loader opens the hosted checkout; merchants should still test the integration on their own site and verify popup behavior in their customers' browsers.
- There is no refund-management interface.
- The server validates asset IDs against the live token registry and validates payout/refund addresses. Production still needs merchant authentication, monitoring and a security review.
- A failed notification after a confirmed on-chain deposit must be reconciled by checking the quote status. Do not send a second deposit for the same quote.
- Never treat a transaction broadcast as a completed payment. Only a 1Click SUCCESS status confirms destination delivery.

## Security

Never commit API secrets, wallet private keys or seed phrases. Use your hosting provider's encrypted environment-variable settings. Do not accept customer payments until the full flow has been tested and independently reviewed.