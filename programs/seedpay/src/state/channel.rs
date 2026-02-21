use anchor_lang::prelude::*;

#[account]
pub struct ChannelState {
    pub leecher: Pubkey, // wallet address of the leecher
    pub seeder: Pubkey, // wallet address of seeder
    pub deposited: u64, // amount deposited in token base units

    // unique channel identifier
    // derived from SHA-256(ECDH Session_UUID)
    // binding this on-chain channel to a specific peer session
    channel_id: [u8; 32],

    pub created_at: i64, // unix timestamp when the channel was created
    pub timeout: i64, // unix timestamp after which leecher can force-close

    pub last_nonce: u64, // highest nonce from submitted payment checks - for replay protection
    pub status: ChannelStatus, // current status of channel

    pub bump: u8, // PDA bump seed
}

#[derived(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ChannelStatus {
    Open, // channel is active, funds locked in escrow
    Closed, // seeder claimed payment via close_channel
    TimedOut, // leecher recovered funds via timeout_close
}

