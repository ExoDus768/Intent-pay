# IntentPay

IntentPay is a starter checkout interface exploring cross-chain payments with NEAR Intents / 1Click.

## Included

- React + Vite checkout interface
- Express API proxy for the 1Click API
- Live token-registry retrieval
- EVM wallet connection UI
- Server-side environment variable handling for the 1Click JWT
- Vercel starter configuration

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Set `ONECLICK_JWT` in `.env` before requesting quotes. Keep the JWT server-side and never expose it in browser code or commit a real secret.

The Vite frontend runs on port 5173 and proxies `/api` requests to the Express server on port 3001.

## Important status and limitations

This repository is an early integration scaffold, not a production-ready payment processor.

- The quote endpoint currently forwards the request body to 1Click. Confirm the exact current request schema and token identifiers against the official 1Click API documentation before using it.
- Token registry fields can change; verify the live response shape before relying on token selection.
- The current UI does not yet submit an on-chain transfer, verify a transaction, or complete the 1Click deposit flow.
- NEAR wallet signing and NEP-141 transfers are not implemented yet.
- Merchant payout destination validation, quote expiry handling, transaction confirmation, webhook/status reconciliation, rate limiting, and security review are still required.
- Do not use real customer funds until the complete payment flow has been implemented, tested with small amounts, and independently reviewed.

## Environment variables

- `ONECLICK_JWT`: server-only 1Click authentication token
- `ONECLICK_MODE`: informational mode label (defaults to `mainnet`)
- `PORT`: Express server port (defaults to `3001`)

## Security

Never commit API secrets, wallet private keys, or seed phrases. Use your hosting provider's encrypted environment-variable settings.
