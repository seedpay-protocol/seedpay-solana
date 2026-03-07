# SeedPay On-Chain Invariants

Security properties the Solana program must maintain. Every invariant listed here
is either enforced by Anchor constraints or by explicit `require!` checks in the
instruction handlers.

## Channel Lifecycle

| Invariant | Enforced by |
|---|---|
| A channel can only be created once for a given (leecher, seeder, channel_id) triple | PDA seed uniqueness (`init` will fail if account exists) |
| A channel starts in `Open` status | `set_inner` in `open_channel_handler` |
| Only `Open` channels can be closed or timed out | `constraint = channel_state.status == ChannelStatus::Open` on both `CloseChannel` and `TimeoutClose` |
| After close/timeout the channel account is deleted | `close = leecher` on `channel_state` in both instructions |
| Double-close is impossible | Account deletion — second call fails with `AccountNotInitialized` |

## Funds Safety

| Invariant | Enforced by |
|---|---|
| Deposit must be > 0 | `require!(amount > 0, ZeroDeposit)` |
| Escrow is owned by the program authority PDA | `token::authority = authority` on escrow account |
| `close_channel` can only transfer ≤ deposited amount | `require!(amount <= channel.deposited, AmountExceedsDeposit)` |
| Seeder receives `amount`, leecher receives `deposited - amount` | Explicit split in `close_channel_handler` |
| `timeout_close` refunds the full escrow balance | Uses `ctx.accounts.escrow.amount` (on-chain truth) |
| Escrow token account is closed after settlement | `close_account` CPI in both close paths |

## Access Control

| Invariant | Enforced by |
|---|---|
| Only the leecher can open a channel | `leecher: Signer` in `OpenChannel` |
| Only the authorized seeder can call `close_channel` | `has_one = seeder` on `CloseChannel` |
| Only the authorized leecher can call `timeout_close` | `has_one = leecher` on `TimeoutClose` |
| `timeout_close` requires timeout to have passed | `require!(clock.unix_timestamp > channel.timeout, TimeoutNotReached)` |

## Payment Check Integrity (Ed25519)

| Invariant | Enforced by |
|---|---|
| A valid Ed25519 SigVerify instruction must precede `close_channel` | Instruction introspection: checks `current_ix_index - 1` targets Ed25519 program |
| The signature must be from the leecher's wallet key | Pubkey comparison against `channel.leecher` |
| The signed message must match `channel_id \|\| amount \|\| nonce` (48 bytes) | Byte-level comparison of reconstructed message |
| All Ed25519 data (sig, pubkey, message) must be in the same instruction | `sig_ix_index == pk_ix_index == msg_ix_index == u16::MAX` |
| Nonce must be strictly increasing | `require!(nonce > channel.last_nonce, StaleNonce)` |

## Timeout Bounds

| Invariant | Enforced by |
|---|---|
| Minimum timeout: 3600 seconds (1 hour) | `require!(timeout_seconds >= 3600, TimeoutTooShort)` |
| Maximum timeout: 604800 seconds (7 days) | `require!(timeout_seconds <= 604800, TimeoutTooLong)` |

## Design Decisions (not bugs)

1. **Seeder can `close_channel` after timeout.** This is intentional — if the seeder has
   a valid signed check, they should be able to claim regardless of timeout. The timeout
   only enables the leecher's force-close path. It's a race: whoever submits first wins.

2. **Self-channels (leecher == seeder) are allowed.** No economic incentive to do this
   and it doesn't break any invariant. Adding a check would be unnecessary complexity.

3. **No maximum deposit enforced on-chain.** Seeder-side policy (e.g. `min_prepayment`,
   max accepted deposit) is enforced off-chain during the handshake phase.
