# SeedPay Architecture

## Package Structure

```mermaid
graph TB
    subgraph "packages/sdk"
        ECDH[ecdh.ts<br/>X25519 + HKDF-SHA256]
        PC[payment-check.ts<br/>Ed25519 sign/verify]
        MSG[messages.ts<br/>9 wire message types]
        ACC[accounting.ts<br/>byte/cost tracking]
        SESSION[session.ts<br/>LeecherSession / SeederSession]
        CC[solana/channel-client.ts<br/>open / close / timeout]
        PDA[solana/pda.ts<br/>PDA derivation]

        SESSION --> ECDH
        SESSION --> PC
        SESSION --> ACC
        SESSION --> MSG
        CC --> PDA
        CC --> PC
    end

    subgraph "packages/bittorrent"
        EXT[extension.ts<br/>BEP 10 + bencode]
        SEEDER[seeder.ts<br/>SeederController]
        LEECHER[leecher.ts<br/>LeecherController]
        TRANSPORT[transport.ts<br/>PeerTransport interface]

        SEEDER --> EXT
        LEECHER --> EXT
        SEEDER --> TRANSPORT
        LEECHER --> TRANSPORT
    end

    subgraph "programs/seedpay"
        PROGRAM[Anchor Program<br/>open_channel / close_channel / timeout_close]
    end

    SEEDER --> SESSION
    LEECHER --> SESSION
    SEEDER -.->|ChannelVerifier| CC
    LEECHER -.->|ChannelOpener| CC
    CC -->|RPC| PROGRAM

    style SESSION fill:#f9f,stroke:#333,stroke-width:2px
    style PROGRAM fill:#bbf,stroke:#333,stroke-width:2px
```

## Session State Machine

### Leecher States

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> handshake: start()
    handshake --> channel_pending: onEcdhInit(seederPubKey)
    channel_pending --> channel_pending: onChannelOpened(txSig)
    channel_pending --> active: onChannelConfirmed()
    channel_pending --> error: onChannelRejected()
    active --> active: onPieceReceived(bytes)
    active --> active: onPaymentCheckRequired()
    active --> closed: onChannelClosed()

    note right of handshake: sends ecdh_init
    note right of channel_pending: returns open_channel action
    note right of active: signs payment checks
```

### Seeder States

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> handshake: onEcdhInit(leecherPubKey)
    handshake --> channel_pending: onChannelOpened(txSig)
    channel_pending --> active: confirmChannel(deposit, pubkey)
    channel_pending --> closed: rejectChannel(reason)
    active --> active: onPaymentCheck(check)
    active --> active: onPieceRequested(bytes)
    active --> closing: initiateClose()
    active --> closing: onDisconnect() [has check]
    active --> closed: onDisconnect() [no check]
    closing --> closed: onChannelClosed()

    note right of handshake: sends ecdh_init reply
    note right of channel_pending: returns verify_channel action
    note right of closing: returns close_channel action
```

## Full Protocol Flow (Sequence Diagram)

```mermaid
sequenceDiagram
    participant L as Leecher
    participant LS as LeecherSession
    participant Net as Wire (BEP 10)
    participant SS as SeederSession
    participant S as Seeder
    participant Chain as Solana

    Note over L,Chain: Phase 1: ECDH Key Exchange

    L->>LS: start()
    LS-->>Net: ecdh_init {publicKey}
    Net-->>SS: ecdh_init {publicKey}
    SS->>SS: deriveSessionKeys()
    SS-->>Net: ecdh_init {publicKey}
    Net-->>LS: ecdh_init {publicKey}
    LS->>LS: deriveSessionKeys()

    Note over L,Chain: Both sides now share channelId = SHA-256(HKDF(X25519(a,B)))

    Note over L,Chain: Phase 2: Channel Opening

    LS->>L: action: open_channel
    L->>Chain: openChannel(channelId, deposit, timeout)
    Chain-->>L: txSignature
    L->>LS: onChannelOpened(txSig)
    LS-->>Net: channel_opened {channelId, txSig}
    Net-->>SS: channel_opened {txSig}
    SS->>S: action: verify_channel

    Note over L,Chain: Phase 3: On-Chain Verification

    S->>Chain: fetchChannel(leecher, seeder, channelId)
    Chain-->>S: {deposited, leecher pubkey, status: open}
    S->>SS: confirmChannel(deposited, leecherPubkey)
    SS-->>Net: channel_confirmed {channelId}
    Net-->>LS: channel_confirmed
    LS->>LS: state → active

    Note over L,Chain: Phase 4: Data Transfer + Payment

    loop Every checkFrequencyMb
        S-->>L: BitTorrent piece data
        L->>LS: onPieceReceived(bytes)
        LS->>LS: accounting.recordBytes()
        LS->>LS: signPaymentCheck(channelId, amount, nonce)
        LS-->>Net: payment_check {channelId, amount, nonce, signature}
        Net-->>SS: payment_check
        SS->>SS: verifyPaymentCheck(check, leecherPubkey)
        SS->>SS: store if highest
    end

    Note over L,Chain: Phase 5: Channel Close

    S->>SS: initiateClose()
    SS->>S: action: close_channel {check}
    S->>Chain: closeChannel(amount, nonce, signature)
    Note over Chain: Ed25519 SigVerify introspection
    Chain->>Chain: verify signature matches leecher
    Chain->>Chain: transfer claimed → seeder
    Chain->>Chain: transfer refund → leecher
    Chain->>Chain: delete channel account
```

## Payment Check Signing

```mermaid
graph LR
    subgraph "48-byte message"
        A[channelId<br/>32 bytes] --> B[amount<br/>u64 LE 8 bytes] --> C[nonce<br/>u64 LE 8 bytes]
    end

    subgraph "Signing"
        D[Ed25519<br/>nacl.sign.detached]
    end

    subgraph "Verification"
        E[Off-chain: nacl.sign.detached.verify]
        F[On-chain: Ed25519 SigVerify IX introspection]
    end

    A --> D
    B --> D
    C --> D
    D --> E
    D --> F
```

## On-Chain PDA Structure

```mermaid
graph TD
    subgraph "PDA Seeds"
        CS["channel_state<br/>seeds: [&quot;channel&quot;, leecher, seeder, channel_id]"]
        ES["escrow<br/>seeds: [&quot;escrow&quot;, channel_state]"]
        AUTH["authority<br/>seeds: [&quot;authority&quot;]"]
    end

    subgraph "Token Flow"
        LTA[Leecher Token Account]
        STA[Seeder Token Account]
    end

    LTA -->|open_channel: deposit| ES
    ES -->|close_channel: claimed| STA
    ES -->|close_channel: refund| LTA
    ES -->|timeout_close: full refund| LTA

    CS -.->|owns| ES
    AUTH -.->|signs transfers| ES
```

## BitTorrent BEP 10 Integration

```mermaid
graph LR
    subgraph "BitTorrent Handshake"
        HS["extended handshake<br/>{m: {seedpay: N}, seedpay_wallet: ..., seedpay_price_per_mb: ...}"]
    end

    subgraph "Extension Messages"
        direction TB
        BEP["BEP 10 envelope<br/>msg_id = N"]
        BEN["bencode({type, ...fields})"]
        SDK["SeedPayMessage (SDK type)"]
    end

    HS --> BEP
    BEP --> BEN
    BEN --> SDK

    subgraph "Controllers"
        SC[SeederController<br/>onHandshake → onExtensionMessage → onPieceRequest]
        LC[LeecherController<br/>onHandshake → onExtensionMessage → onPieceReceived]
    end

    SDK --> SC
    SDK --> LC
```
