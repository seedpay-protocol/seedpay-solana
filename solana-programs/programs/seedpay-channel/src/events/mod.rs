use anchor_lang::prelude::*;

#[event]
pub struct ChannelOpened {
    pub channel: Pubkey,
    pub leecher: Pubkey,
    pub seeder: Pubkey,
    pub amount: u64,
    pub timeout: i64,
    pub session_hash: [u8; 32],
}

#[event]
pub struct ChannelClosed {
    pub channel: Pubkey,
    pub seeder_amount: u64,
    pub leecher_refund: u64,
    pub final_nonce: u64,
}

#[event]
pub struct ChannelTimedOut {
    pub channel: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct PaymentCheckSubmitted {
    pub channel: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}
