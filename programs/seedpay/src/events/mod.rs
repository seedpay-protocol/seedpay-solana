use anchor_lang::prelude::*;

#[event]
pub struct ChannelOpened {
    pub leecher: Pubkey,
    pub seeder: Pubkey,
    pub channel_id: [u8; 32],
    pub deposited: u64,
    pub timeout: i64,
}

#[event]
pub struct ChannelClosed {
    pub leecher: Pubkey,
    pub seeder: Pubkey,
    pub channel_id: [u8; 32],
    pub seeder_earned: u64,
    pub leecher_refunded: u64,
    pub nonce: u64,
}

#[event]
pub struct ChannelTimedOut {
    pub leecher: Pubkey,
    pub seeder: Pubkey,
    pub channel_id: [u8; 32],
    pub refunded: u64,
}
