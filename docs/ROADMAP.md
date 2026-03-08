# SeedPay Roadmap: From On-Chain Primitive to BitTorrent Integration

## Current State (Completed)

### On-Chain Program (`programs/seedpay/`)
- 3 instructions: `open_channel`, `close_channel` (Ed25519 sig verify), `timeout_close`
- Structured events: `ChannelOpened`, `ChannelClosed`, `ChannelTimedOut`
- 22 tests covering happy paths, error cases, and edge cases
- Security invariants documented in `INVARIANTS.md`
- Deployed to Solana devnet

### SDK (`packages/sdk/`)
- ECDH key exchange (X25519 + HKDF)
- Payment check signing/verification (Ed25519)
- Solana channel client (open, close, timeout, fetch)
- PDA derivation

### Demo (`packages/demo/`)
- Full lifecycle orchestrator: ECDH → Open → Transfer → Close
- Runs on devnet

---

## Phase 1: SDK Protocol Layer (Next)

Extend `packages/sdk/` with transport-agnostic protocol logic. No new packages — just new modules alongside existing code.

### 1.1 Protocol Messages (`messages.ts`)

Define types and encode/decode for all SeedPay wire messages from PROTOCOL.md:

| Message | Direction | Purpose |
|---|---|---|
| `ecdh_init` | Both | Exchange ephemeral public keys |
| `channel_opened` | Leecher → Seeder | Notify of on-chain channel creation |
| `channel_confirmed` | Seeder → Leecher | Confirm channel verified on-chain |
| `channel_rejected` | Seeder → Leecher | Reject channel with reason |
| `payment_check` | Leecher → Seeder | Authorize cumulative payment |
| `payment_check_required` | Seeder → Leecher | Request payment before more data |
| `payment_check_rejected` | Seeder → Leecher | Reject invalid payment check |
| `channel_closed` | Either | Notify channel closed on-chain |
| `channel_timeout_warning` | Seeder → Leecher | Warn timeout approaching |

All messages use a discriminated union on `type` field. BigInt values serialized as strings, Uint8Array as hex. Transport-agnostic — no bencode, no JSON assumptions. Encode/decode to plain objects.

### 1.2 Accounting (`accounting.ts`)

Byte-to-cost tracking extracted from the demo's inline logic:

- `computeCost(bytes, pricePerMb)` — pure function
- `shouldSendCheck(...)` — determines check frequency
- `isPaymentSufficient(...)` — seeder-side gate
- `PieceAccounting` class — stateful tracker for a session

### 1.3 Session State Machine (`session.ts`)

Pure state machine (no I/O, returns action arrays). Two variants:

**`LeecherSession`**: Manages leecher-side lifecycle
```
Idle → start() → Handshake
     → onEcdhInit() → KeyExchange
     → onChannelConfirmed() → Active
     → onPieceReceived(bytes) → [may return sign_check action]
     → onChannelClosed() → Closed
```

**`SeederSession`**: Manages seeder-side lifecycle
```
Idle → onEcdhInit() → KeyExchange
     → onChannelOpened() → ChannelPending
     → confirmChannel() → Active
     → onPieceRequested(bytes) → [may return payment_check_required]
     → onPaymentCheck() → [validates, updates highest check]
     → initiateClose() → Closing → Closed
```

Key design: methods return `SessionAction[]` arrays (commands like "send this message", "open channel on-chain", "verify this tx"). The caller executes the side effects. This makes the state machine fully testable without mocks.

---

## Phase 2: BitTorrent BEP 10 Adapter

New package: `packages/bittorrent/`. This is the use-case layer — knows about BitTorrent wire protocol, depends on `@seedpay/sdk`.

### 2.1 Extension Adapter (`extension.ts`)

Maps SDK messages to/from BEP 10 bencoded extension messages:

- Extension name: `"seedpay"` in BEP 10 `m` dictionary
- Handshake metadata: `{ wallet, price_per_mb, min_prepayment, chain }`
- `encodeBep10Message(SeedPayMessage) → Buffer`
- `decodeBep10Message(Buffer) → SeedPayMessage`
- `ExtensionNegotiator` — tracks local/remote extension IDs

### 2.2 Seeder Controller (`seeder.ts`)

Wires `SeederSession` + `ChannelClient` + BEP 10 transport:

```typescript
interface PeerTransport {
  sendExtensionMessage(extensionId: number, data: Buffer): void;
  disconnect(): void;
}

class SeederController {
  onHandshake(remoteExtensions, remoteMeta): void;
  onExtensionMessage(data: Buffer): Promise<void>;
  onPieceRequest(pieceIndex, pieceLength): { serve: boolean };
  onDisconnect(): Promise<void>;
}
```

### 2.3 Leecher Controller (`leecher.ts`)

Wires `LeecherSession` + `ChannelClient` + BEP 10 transport:

```typescript
class LeecherController {
  onHandshake(remoteExtensions, remoteMeta): Promise<void>;
  onExtensionMessage(data: Buffer): Promise<void>;
  onPieceReceived(pieceIndex, pieceLength): Promise<void>;
  onComplete(): void;
  onDisconnect(): void;
}
```

The `PeerTransport` interface is intentionally minimal — it works with any BitTorrent client that supports BEP 10.

---

## Phase 3: CLI Tool

Standalone command-line client wrapping webtorrent + our extension:

```bash
# Seed a file and earn USDC
seedpay seed myfile.torrent --wallet ~/.config/solana/id.json --price 0.0001

# Download and pay seeders
seedpay download magnet:?xt=urn:btih:... --wallet ~/.config/solana/id.json

# Check earnings
seedpay balance --wallet ~/.config/solana/id.json
```

This is the first real-world integration. Useful for:
- AI model distribution (pay seeders to keep models available)
- Chain snapshots (Solana/Ethereum node operators)
- Scientific datasets
- Any long-tail content that dies without seeder incentives

---

## Phase 4: Desktop Client (Future)

Fork webtorrent-desktop (Electron app) with SeedPay baked in:

- Drag-and-drop torrent UI with payment overlay
- Wallet connection (Phantom, Solflare, or local keypair)
- Earnings dashboard
- Same `@seedpay/bittorrent` package under the hood

**Fully interoperable** with CLI users — same wire protocol, same extension.

---

## Phase 5: Broader Client Adoption (Future)

### libtorrent Plugin
Port to C++ libtorrent plugin. This powers qBittorrent (~100M users), Deluge (~20M users). Could be:
- Submitted as PR to libtorrent itself
- Distributed as standalone plugin

### Client-Native Integration
Once libtorrent plugin exists, desktop clients can add native UI:
- qBittorrent: Settings → SeedPay → Enable paid seeding
- Deluge: Plugin manager → Install SeedPay

This requires proven adoption and user demand from Phases 3-4.

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  Desktop Client  OR  CLI Tool           │  ← UI / UX layer
│  (webtorrent-desktop fork / seedpay-cli)│
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  @seedpay/bittorrent                    │  ← Use-case layer
│  BEP 10 extension adapter              │
│  SeederController / LeecherController   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  @seedpay/sdk                           │  ← Agnostic layer
│  ┌────────────────────────────────────┐ │
│  │ messages.ts  session.ts            │ │  ← Protocol (transport-agnostic)
│  │ accounting.ts  ecdh.ts             │ │
│  │ payment-check.ts                   │ │
│  ├────────────────────────────────────┤ │
│  │ solana/channel-client.ts           │ │  ← Chain-specific
│  │ solana/pda.ts                      │ │
│  └────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Solana Program (programs/seedpay/)     │  ← On-chain
│  open_channel | close_channel           │
│  timeout_close                          │
└─────────────────────────────────────────┘
```

## Interoperability

All clients (CLI, desktop, future libtorrent) are interoperable because they:
1. Speak standard BitTorrent protocol (BEP 3)
2. Use BEP 10 extension protocol for SeedPay messages
3. Settle on the same Solana program

A desktop user downloading from a CLI seeder just works. A qBittorrent user with the libtorrent plugin can pay a webtorrent CLI seeder. The protocol is the common language.

## Implementation Order

| Phase | Package | What | Depends on |
|---|---|---|---|
| 1.1 | sdk | `messages.ts` + tests | nothing new |
| 1.2 | sdk | `accounting.ts` + tests | nothing new |
| 1.3 | sdk | `session.ts` + tests | 1.1, 1.2 |
| 1.4 | sdk | Update exports | 1.1-1.3 |
| 2.1 | bittorrent | `extension.ts` + tests | 1.4 |
| 2.2 | bittorrent | `seeder.ts` + tests | 2.1 |
| 2.3 | bittorrent | `leecher.ts` + tests | 2.1 |
| 3 | cli | CLI tool wrapping webtorrent | 2.1-2.3 |
| 4 | desktop | webtorrent-desktop fork | 2.1-2.3 |
| 5 | libtorrent | C++ plugin | 1.1-1.3 (protocol only) |
