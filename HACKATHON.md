# XoDuspay — NEAR Intents Hackathon

## Project summary

XoDuspay is a universal crypto checkout built around **NEAR Intents and the 1Click API**. Any merchant or app can publish a checkout button. Customers open a hosted checkout and pay from a supported wallet and network, while the merchant receives their configured payout asset at their receiving address.

The project is focused entirely on the universal checkout widget. Customers choose a supported payment asset and merchants receive their configured payout asset through the checkout flow.

## NEAR Intents integration

1. Load supported assets from the live 1Click token registry.
2. The merchant selects a payout network, token, recipient address and fixed or variable amount mode in the Merchant Workspace.
3. XoDuspay generates a hosted checkout URL and embeddable button.
4. The customer opens checkout, selects a supported source network and token, and connects their wallet.
5. XoDuspay requests a committed 1Click quote with a unique deposit address.
6. The customer reviews the amount, quote, fees and destination, then approves the deposit in their wallet.
7. XoDuspay submits the confirmed deposit transaction where required and polls 1Click status.
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

## Judge quick test (do X, see Y)

Use the deployed mainnet app. This prototype moves real assets; test only with a small amount you can afford to lose.

| Do this | Expected result |
|---|---|
| Open the landing page | Product overview and navigation load |
| Open /merchant | Merchant checkout configuration appears |
| Select a payout network/token, receiving address and amount mode | Merchant payout configuration is reflected in checkout setup |
| Generate the checkout link and open it | Customer checkout loads with the merchant configuration |
| Connect a supported wallet and select an available source asset | Wallet and selected source asset are displayed |
| Request a quote | A committed 1Click quote and deposit instructions are returned if that route/amount is supported |
| Review and approve the wallet transaction | Wallet prompts the customer to authorize the payment |
| Wait for 1Click status | Only 1Click SUCCESS confirms completed destination delivery |

If a quote is rejected or no deposit address is created, stop; do not describe that attempt as a completed payment. Route availability and minimums come from the live 1Click response.

## Demo flow

1. Open the XoDuspay homepage.
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

## Test status (mainnet)

The project checkout and wallet flows have been tested and verified on the supported mainnet networks below, except BNB Smart Chain (BSC), which remains pending verification.

| Network | Status |
|---|---|
| NEAR | Verified |
| Ethereum | Verified |
| Base | Verified |
| Arbitrum | Verified |
| Optimism | Verified |
| Polygon | Verified |
| Avalanche | Verified |
| Gnosis | Verified |
| Berachain | Verified |
| Scroll | Verified |
| Aurora | Verified |
| BNB Smart Chain (BSC) | **Not yet verified — testing pending** |

BSC must not be presented as tested or relied on for a live checkout until wallet connection, asset detection, deposit and 1Click settlement have all been confirmed. These test statuses are not a security audit and do not imply that every registry-listed asset supports a deposit flow.

## Current limitations

- Merchant accounts and saved widget configurations are not implemented.
- Direct EVM fallback supports ERC-20 tokens only and only for an exact same-token, same-network payout.
- Other non-EVM wallet deposit flows are not implemented, even if their assets appear in the live registry as payout options.
- The app is a hackathon prototype, not an audited payment processor. Do not use it for high-value production payments without a full security review.

## Submission materials

See [docs/HACKATHON-SUBMISSION.md](./docs/HACKATHON-SUBMISSION.md) for the form-ready project description, X demo-post draft, three-minute demo sequence, judge walkthrough and final checklist.
