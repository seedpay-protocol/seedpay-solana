use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("7DwPMoGzTjRUroE47VPEEJn4FBSypAA5dbeMn3ocVdsS");

#[program]
pub mod seedpay {
    use super::*;

    pub fn open_channel(
        ctx: Context<OpenChannel>,
        channel_id: [u8; 32],
        amount: u64,
        timeout_seconds: i64
    ) -> Result<()> {
        instructions::open_channel::open_channel_handler(
            ctx, 
            channel_id, 
            amount, 
            timeout_seconds
        )
    }

    pub fn timeout_close(ctx: Context<TimeoutClose>) -> Result<()> {
        instructions::timeout_close::timeout_close_handler(ctx)
    }

    pub fn close_channel(ctx: Context<CloseChannel>, amount: u64, nonce: u64) -> Result<()> {
        instructions::close_channel::close_channel_handler(ctx, amount, nonce)
    }
}
