use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("F4N3pehAbyRhvHWj62r5C5DMKMcwJj2ry6TdF5GzpBo6");

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
}
