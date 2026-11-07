# Social Pay

A standalone frontend preview exploring social crypto payments addressed to X usernames.

## Current scope

- Send and claim preview screens.
- Case-insensitive X username input.
- Mainnet safety notice.
- No wallet connection, escrow, X OAuth, transfer, claim or refund backend is implemented.
- No funds can be sent or claimed from this preview.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Build with `npm run build`.

## Security and next steps

Before enabling transfers, implement and independently review escrow, identity verification, replay protection, expiry/refund handling and wallet authorization. Never collect private keys or seed phrases.
