# SeedPay - Architecturel Diagrams

**Capstone Project - Week 3 Assignment**

_Payment Protocol for BitTorrent Networks_  
_Seeders earn crypto for sharing files. Leechers pay for faster downloads._

---

## High Level System Overview

![High Level System Overview](./images/high.png)

- **How It Works:**
  1. Peers discover each other via BitTorrent and negotiate pricing through SeedPay extension (BEP 10).
  2. Leecher opens a payment channel on Solana (`open_channel`), locking USDC in escrow.
  3. Data transfers via BitTorrent. Leecher sends signed-off payments checks as data is received.
  4. Seeder submits highest payment check to close channel, or Leecher force-recovers after timeout.
  5. ECDH ephemeral keys ensure on-chain payments can not be linked to download activity.

## Program Structure & Instruction Flow

![Program Structure & Instruction Flow](./images/program-structure.png)
