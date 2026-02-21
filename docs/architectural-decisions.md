## Deviation Log

For tracking the design decisions made during PoC build that deviate from existing protocol spec (v0.3) and [architectural diagrams](./architecture-diagram.md).

1. Escrow Address - Derive instead of store
   Originally channel state included escrow address as stored field. Now we have decided to derive it from seeds.

   Rationale:
   - Saves 32 bytes of rent per channel
   - Anchor derives and validates it automatically via account constraints
   - Escrow PDA is deterministic from channel state address so no information is lost

2. PDA Seeds - channel_id replaces nonce

   Originally the seeds were `seeds = ["seedpay", "channel", leecher_pubkey, seeder_pubkey, nonce(u64)]`. Now as per new decision they are `seeds = [b"channel", leecher_pubkey, seeder_pubkey, channel_id([u8; 32])]`

   Changes:
   - Dropped `seedpay` prefix as program ID already namespaces. Single prefix `channel` is sufficient.
   - Replaced `nonce: u64` with `channel_id: [u8; 32]`

   Rationale:
   - `channel_id` provides 256-bit uniqueness
   - `channel_id` can carry semantic meaning (see Deviation 3)
   - No global counter or coordination needed - random 32 bytes or session-derived
   - Collision probablility is negligible with 256 bits

3. channel_id = Session Hash (Memo dropped)

   Originaly `channel_id` was derived from `SHA-256(leecher_wallet || seeder_wallet || timestamp || nonce)` - No connection to ECDH session.
   Session binding happened via memo: `session_hash = SHA-256(Session_UUID)` attached to transaction via Memo Program CPI.
   Seeder validated session binding by reading memo from transaction.

   Now as per new decision, `channel_id = SHA-256(Session_UUID)` - the `channel_id` IS the binding and Memo program dropped entirely - No CPI, No Memo Instruction.
   Seeder validates session binding by deriving channel PDA (which includes channel_id) in seeds.

   Rationale:
   - Unified two concepts (channel identity and session binding) into one.
   - Removes an entire extra dependency (Memo program)
   - Simpler program
   - Simpler client
   - Chain-agnostic: memo is Solana-specific feature. Embedding session binding in account derivation works on any chain (Ethereum CREATE2, Sui objectIDs, etc.)
   - Same security: SHA-256 preimage resistance still prevents observers from linking session_hash to download activity.
   - Same verification: Seeder computes SHA-256 (Session_UUID) locally and uses it to derive PDA - if it matchges, session is bound.
