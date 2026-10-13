# Qairos Quantum Console

English-language Qairos dashboard built with Next.js, TypeScript, Tailwind CSS, ethers and ML-DSA-44.

## Start

```bash
npm install
npm run dev
```

Open http://localhost:3000. The dashboard reads the public Mainnet snapshot from `https://qairos.tech/api/mainnet/status` by default. Read-only monitoring works without a wallet.

## Wallet API

Wallet sign-in and transaction preparation require the official same-origin API. For local development, run the API separately, set `APP_ORIGIN=http://localhost:3000` there, configure its PostgreSQL and Ethereum RPC settings, then copy `.env.example` to `.env.local`. `QAIROS_API_ORIGIN=http://localhost:8080` makes Next proxy `/api/*` to that service. The API owns its secrets; none belong in `NEXT_PUBLIC_*` variables.

For production, serve the app and `/api` from the same HTTPS origin or configure the trusted ingress to proxy `/api` to the API. The API must be configured with the exact canonical `APP_ORIGIN` and the same session database. Do not proxy wallet-authentication requests to a third-party Qairos origin.

## Wallets And Transactions

Set `NEXT_PUBLIC_PRIVY_APP_ID` in `.env.local` to enable the Privy wallet connection modal. The Privy connection is bridged into the same wallet session and transaction review flow used by other wallets. Without the App ID, the chooser discovers EIP-6963 and legacy EIP-1193 providers, including installed MetaMask, Rabby, Coinbase Wallet, Brave, Trust and OKX wallets. QR/WalletConnect is not configured by the official Qairos deployment, so this app does not display a nonfunctional QR option.

Writes are gated on a matching wallet session and Ethereum Mainnet. Each operation is simulated and gas-estimated, reviewed on screen, rechecked immediately before sending, then confirmed in the wallet. Qairos contracts are experimental and unaudited; the UI does not imply that monitoring guarantees safety.

## Verification

```bash
npm run build
npm audit
```
