# ⊕ Bitcoin Wishing Well — Mainnet

Inscribe your wish forever on Bitcoin mainnet using Ordinals Protocol.

Live wallet integration with **Xverse** (sats-connect v2) and **UniSat** (window.unisat API).

---

## Wallet support

### Xverse — no API key needed
Uses sats-connect v2 `createInscription` directly.
- Connects via `getAddress()` with `AddressPurpose.Ordinals` + `AddressPurpose.Payment`
- Inscribes via `createInscription()` on `BitcoinNetworkType.Mainnet`
- Registry fee (2,000 sats) embedded in inscription tx via `appFee` + `appFeeAddress` — one transaction
- Install: [xverse.app](https://xverse.app)

### UniSat — free API key required
Uses UniSat Open API + `window.unisat.sendBitcoin`.
- Auto-switches to `BITCOIN_MAINNET` if on wrong chain
- Creates order via `/v2/inscribe/order/create`, polls for confirmation
- Get free API key: [developer.unisat.io](https://developer.unisat.io/)
- Install: [unisat.io](https://unisat.io)

---

## One-time setup

Open `index.html`, find this line and paste your UniSat API key:

```js
const UNISAT_API_KEY = ''; // ← paste here
```

Xverse works with zero setup — no key needed.

---

## Xverse inscription flow

```
createInscription() called
  → Xverse popup (user reviews content + fees)
  → User approves
  → Commit + reveal txs broadcast
  → txId returned and saved
```

## UniSat inscription flow

```
POST /v2/inscribe/order/create
  → Returns payAddress + amount
  → window.unisat.sendBitcoin() called
  → UniSat popup, user approves
  → App polls order status until inscriptionId appears
  → Saved to Inscriptions tab
```

---

## Registry fee

`3FxKYyYJcxn6Tx2RvQM8szTzYKTQYskgWq` — 2,000 sats  
- Xverse: included as `appFee` in the inscription tx (one approval)  
- UniSat: included as `devFee` in the order body

All registered inscriptions contain `"app":"bitcoin-wishing-well-v1"` for on-chain indexing.

---

## Deploy

```
/
├── index.html    ← entire app, zero build step
├── README.md
└── vercel.json
```

Vercel: New Project → Import repo → Framework: Other → Deploy  
Netlify: New site → Import → Publish dir: `.` → Deploy  
GitHub Pages: Settings → Pages → Source: main `/`
