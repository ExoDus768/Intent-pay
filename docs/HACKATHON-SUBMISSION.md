# XoDuspay — NEAR HACKATHON Submission Pack

## Project details

- **Project:** XoDuspay
- **Primary track:** Real-World Money
- **Live app:** https://xoduspay-exo-c836.vercel.app/
- **Merchant workspace:** https://xoduspay-exo-c836.vercel.app/merchant
- **Public repository:** https://github.com/ExoDus768/XoDuspay-
- **Project X account:** https://x.com/XoDuspay

## Submission description

XoDuspay is a universal crypto checkout widget powered by NEAR Intents and the 1Click API. It lets a merchant configure a payout asset and receiving address, then publish one hosted checkout link, QR code or embeddable website button. A customer opens checkout, connects a supported wallet, selects an available source asset, reviews a committed cross-chain quote and approves the payment in their own wallet. XoDuspay tracks the 1Click execution status and treats delivery as complete only when 1Click reports SUCCESS. The project focuses on making cross-chain crypto payments practical for everyday merchants without requiring them to build a separate checkout for every network.

## Demo post draft for X

Built XoDuspay at @NEARProtocol’s #NEARHackathon — a universal crypto checkout widget powered by NEAR Intents + 1Click.

Merchants publish one hosted link, QR code or website button. Customers pay from supported wallets and networks, while merchants receive their configured payout asset.

[Attach the demo video]

## Three-minute demo sequence

1. **0:00–0:20 — Problem and product:** Open the landing page. Explain fragmented wallets, networks and checkout integrations.
2. **0:20–0:50 — Merchant setup:** Open /merchant. Select payout network/token, receiving address and fixed or variable amount.
3. **0:50–1:15 — Publish:** Show the hosted checkout link, QR code and embed snippet.
4. **1:15–1:50 — Customer checkout:** Open the hosted checkout, select an available source asset and connect a supported wallet. Show the live 1Click quote.
5. **1:50–2:30 — Payment proof:** Show the real ETH-to-NEAR mainnet transaction and the corresponding 1Click SUCCESS status. Never substitute a mock transaction or invented hash.
6. **2:30–2:45 — Network status:** Show the verified network list and explicitly mark BNB Smart Chain (BSC) as pending verification.
7. **2:45–3:00 — Close:** Return to the landing page and state the value proposition.

## Judge walkthrough: do this, see this

Use the deployed app and a small amount you can afford to lose. The checkout is mainnet-only and transactions move real assets.

| Do this | Expected result |
|---|---|
| Open the landing page | XoDuspay product overview and navigation load |
| Open the Merchant Workspace | Merchant checkout configuration is displayed |
| Choose a payout network/token and enter a valid receiving address | The selected payout destination is reflected in the checkout setup |
| Choose fixed amount or customer-entered amount | The chosen amount mode is reflected in the generated checkout |
| Generate the checkout and open its hosted URL | The customer checkout loads with the merchant configuration |
| Connect a supported wallet and select an available source asset | The connected wallet and selected asset are shown |
| Request a quote | A committed 1Click quote and unique deposit instructions are returned when the selected route and amount are supported |
| Review and approve the wallet transaction | The wallet asks the customer to authorize the transaction |
| Wait for 1Click status | Only 1Click SUCCESS is treated as completed destination delivery |

If a quote is rejected, no deposit address is created, or the selected route is unavailable, stop and do not describe that attempt as a completed payment. Availability and minimums are determined by the live 1Click route/quote response.

## Verified scope and limitations

Mainnet checkout and wallet flows have been verified for NEAR, Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Gnosis, Berachain, Scroll and Aurora. BNB Smart Chain (BSC) remains **pending end-to-end verification** and must not be described as verified.

The live 1Click registry can list assets that do not have a corresponding browser deposit flow in this prototype. Only use origin networks and tokens for which the checkout exposes a supported wallet flow. The project is a hackathon prototype, not an audited payment processor. Merchant accounts and saved merchant profiles are not implemented; customer cross-device history synchronization has not been end-to-end verified.

## Final submission checklist

- [ ] Confirm this repository is public and the latest main branch is visible.
- [ ] Confirm the live app and /merchant workspace load.
- [ ] Publish the demo post on X. It must say the project was built at NEAR HACKATHON, tag @NEARProtocol, include #NEARHackathon, and attach the demo video or screenshots.
- [ ] Copy the public X post URL.
- [ ] Have the NEAR account address ready for potential prize payout.
- [ ] Complete the official form with the repository URL and demo-post URL before **14 November 2026, 23:59 UTC**.
- [ ] Review every field before submitting. The official site says to submit once per project.

**Do not mark this checklist complete until each item has actually been done.**
