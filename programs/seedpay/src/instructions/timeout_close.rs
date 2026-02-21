use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Transfer, transfer, CloseAccount, close_account};

use crate::state::*;
use crate::errors::SeedPayError;

#[derive(Accounts)]
pub struct TimeoutClose<'info> {
    /// leecher requesting the refund - must be the original depositor
    #[account(mut)]
    pub leecher: Signer<'info>,

    /// channel state - will be closed (rent returned to leecher)
    #[account(
        mut,
        close = leecher,
        seeds = [b"channel", channel_state.leecher.as_ref(), channel_state.seeder.as_ref(), channel_state.channel_id.as_ref()],
        bump = channel_state.bump,
        has_one = leecher @ SeedPayError::UnauthorizedLeecher,
        constraint = channel_state.status == ChannelStatus::Open @ SeedPayError::ChannelNotOpen,
    )]
    pub channel_state: Account<'info, ChannelState>,

    // escrow token account
    #[account(
        mut,
        seeds = [b"escrow", channel_state.key().as_ref()],
        bump,
        token::authority = authority,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// leecher's USDC account - where refund goes
    #[account(
        mut,
        token::authority = leecher,
    )]
    pub leecher_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA used only as signing authority
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn timeout_close_handler(ctx: Context<TimeoutClose>) -> Result<()> {
    let channel = &ctx.accounts.channel_state;

    // check that timeout has passed
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp > channel.timeout,
        SeedPayError::TimeoutNotReached
    );

    // capture refund amount before escrow is closed
    let refund_amount = ctx.accounts.escrow.amount;

    // build PDA signer seeds for authority
    let authority_bump = ctx.bumps.authority;
    let authority_seeds: &[&[u8]] = &[b"authority", &[authority_bump]];
    let signer_seeds = &[authority_seeds];

    // transfer all escrowed tokens back to leecher
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow.to_account_info(),
            to: ctx.accounts.leecher_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
        signer_seeds,
    );
    transfer(transfer_ctx, refund_amount)?;

    // close escrow token account (rent -> leecher)
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.leecher.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
        signer_seeds,
    );
    close_account(close_ctx)?;

    // update status (channel_state account is closed by `close = leecher` at exit)
    ctx.accounts.channel_state.status = ChannelStatus::TimedOut;

    msg!("Channel timed out: {} tokens refunded to leecher", refund_amount);

    Ok(())
}
