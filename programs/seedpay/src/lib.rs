use anchor_lang::prelude::*;

declare_id!("F4N3pehAbyRhvHWj62r5C5DMKMcwJj2ry6TdF5GzpBo6");

#[program]
pub mod seedpay {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
