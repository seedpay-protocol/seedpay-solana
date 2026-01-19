use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PaymentChannel {
    pub leecher: Pubkey,
    pub seeder: Pubkey,
    pub escrow: Pubkey,
    pub mint: Pubkey,
    pub deposited: u64,
    pub created_at: i64,
    pub timeout: i64,
    pub session_hash: [u8; 32],
    pub last_nonce: u64,
    pub last_amount: u64,
    pub status: ChannelStatus,
    pub bump: u8,
    pub escrow_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ChannelStatus {
    Open,
    Closed,
    TimedOut,
}

impl Default for ChannelStatus {
    fn default() -> Self {
        ChannelStatus::Open
    }
}

impl PaymentChannel {
    pub const SEED_PREFIX: &'static [u8] = b"channel";
    pub const ESCROW_SEED_PREFIX: &'static [u8] = b"escrow";

    pub fn is_open(&self) -> bool {
        self.status == ChannelStatus::Open
    }

    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        current_timestamp > self.timeout
    }

    pub fn remaining_balance(&self, paid_amount: u64) -> u64 {
        self.deposited.saturating_sub(paid_amount)
    }
}
