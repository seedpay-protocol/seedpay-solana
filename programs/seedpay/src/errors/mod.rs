use anchor_lang::prelude::*;

#[error_code]
pub enum SeedPayError {
    #[msg("Deposite amount must be greater than zero")]
    ZeroDeposit,

    #[msg("Timeout duration too short (minimum 3600 seconds)")]
    TimeoutTooShort,

    #[msg("Timeout duration too long (maximum 604800 seconds")]
    TimeoutTooLong,
}