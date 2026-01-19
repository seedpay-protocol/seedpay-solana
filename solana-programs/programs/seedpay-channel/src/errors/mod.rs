use anchor_lang::prelude::*;

#[error_code]
pub enum SeedPayError {
    #[msg("Channel is not open")]
    ChannelNotOpen,

    #[msg("Channel has not expired yet")]
    ChannelNotExpired,

    #[msg("Payment check nonce is stale (must be greater than last used nonce)")]
    StaleNonce,

    #[msg("Amount exceeds channel deposit")]
    AmountExceedsDeposit,

    #[msg("Amount must be monotonically increasing")]
    AmountNotIncreasing,

    #[msg("Invalid payment check signature")]
    InvalidSignature,

    #[msg("Missing or invalid Ed25519 verification instruction")]
    MissingEd25519Instruction,

    #[msg("Invalid seeder token account owner")]
    InvalidSeederAccount,

    #[msg("Invalid leecher token account owner")]
    InvalidLeecherAccount,

    #[msg("Only leecher can force-close via timeout")]
    NotLeecher,

    #[msg("Only seeder can perform cooperative close")]
    NotSeeder,

    #[msg("Session hash mismatch")]
    SessionHashMismatch,

    #[msg("Channel already closed")]
    ChannelAlreadyClosed,

    #[msg("Timeout must be at least 1 hour (3600 seconds)")]
    TimeoutTooShort,

    #[msg("Deposit amount must be greater than zero")]
    DepositTooLow,

    #[msg("Session hash cannot be all zeros")]
    InvalidSessionHash,
}
