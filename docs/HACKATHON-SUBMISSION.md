# XoDuspay — NEAR HACKATHON Project Brief

## Project overview

**XoDuspay** is a universal crypto checkout widget powered by NEAR Intents and the 1Click API. It helps merchants accept payments from supported wallets and networks while receiving a configured payout asset.

Merchants configure a checkout and share it through a hosted link, QR code or embeddable website button. Customers connect a supported wallet, select an available source asset, review a cross-chain quote and approve the payment in their wallet. XoDuspay tracks execution through the 1Click status flow.

## Project links

- **Live application:** https://xoduspay-exo-c836.vercel.app/
- **Merchant workspace:** https://xoduspay-exo-c836.vercel.app/merchant
- **Source code:** https://github.com/ExoDus768/XoDuspay-
- **Project X account:** https://x.com/XoDuspay

## Why it matters

Crypto users hold assets across different chains and wallets. Merchants should not need to integrate and maintain a separate checkout for every network. XoDuspay aims to make cross-chain payment acceptance feel like one checkout experience.

## Three-minute product demonstration

1. **Product introduction:** Show the landing page and explain the fragmented cross-chain checkout problem.
2. **Merchant setup:** Open the Merchant Workspace and configure the payout network, token, receiving address and amount mode.
3. **Checkout publishing:** Show the hosted checkout link, QR code and embed option.
4. **Customer payment:** Open the checkout, connect a supported wallet, select a source asset and request a 1Click quote.
5. **Payment history:** Show the app's transaction history and the two successful records below.
6. **Wrap-up:** Explain how one checkout can support customers paying from different supported networks.

## Payment examples shown in the application

The transaction-history screen displays these two records with **SUCCESS** status:

| Route | Amount paid | Amount received |
|---|---:|---:|
| Ethereum → Solana | 0.0001 ETH | 0.002337372 SOL |
| Ethereum → Arbitrum | 0.00005 ETH | 0.599803468311947155 ARB |

Transaction references:

- [Ethereum transaction — Solana route](https://etherscan.io/tx/0xcbace6d3c9fc43089d688ac4e6742b1bf30e8b6e200a3421c98254b6a0bc79be)
- [Ethereum transaction — Arbitrum route](https://etherscan.io/tx/0x378cc8db00fcc68e61fdf6473400f4e42ed8f34129907a800ff3166c40ca5cdc)

## Supported scope and current limitations

Mainnet checkout and wallet flows have been exercised for NEAR, Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Gnosis, Berachain, Scroll and Aurora. Route and token availability depends on the live NEAR Intents / 1Click quote response and the wallet flow available in the application. BNB Smart Chain (BSC) is not yet verified end-to-end.

XoDuspay is a hackathon prototype, not an audited payment processor. A route should be considered complete only when the 1Click execution status reports **SUCCESS**.