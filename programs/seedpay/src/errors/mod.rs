use anchor_lang::prelude::*;

#[error_code]
pub enum SeedPayError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,

    #[msg("Timeout duration too short (minimum 3600 seconds)")]
    TimeoutTooShort,

    #[msg("Timeout duration too long (maximum 604800 seconds)")]
    TimeoutTooLong,

    #[msg("Unauthorized: caller is not the channel leecher")]
    UnauthorizedLeecher,

     #[msg("Channel is not in Open status")]
    ChannelNotOpen,

    #[msg("Timeout has not passed")]
    TimeoutNotReached,

    #[msg("Unauthorized: caller is not the channel seeder")]
    UnauthorizedSeeder,

    #[msg("Claimed amount exceeds channel deposit")]
    AmountExceedsDeposit,

    #[msg("Nonce must be greater than last accepted nonce")]
    StaleNonce,

    #[msg("Missing Ed25519 SigVerify instruction before close_channel")]
    MissingEd25519Instruction,

    #[msg("Instruction does not target the Ed25519 native program")]
    InvalidEd25519Program,

    #[msg("Malformed Ed25519 SigVerify instruction data")]
    InvalidEd25519Instruction,

    #[msg("Ed25519 signer does not match the channel leecher")]
    SignerMismatch,

    #[msg("Ed25519 message does not match expected payment check")]
    MessageMismatch,
}