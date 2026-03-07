use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint, Transfer, transfer};

use crate::state::*;
use crate::errors::SeedPayError;
use crate::events::ChannelOpened;

#[derive(Accounts)]
#[instruction(channel_id: [u8; 32])]
pub struct OpenChannel<'info> {
    // leecher opens the channel. Pays for account creation and deposits USDC.
    #[account(mut)]
    pub leecher: Signer<'info>,

    /// CHECK: we only need this pubkey. No data is read or written.
    pub seeder: UncheckedAccount<'info>,

    // channel state pda
    #[account(
        init, // created by this instruction
        payer=leecher, 
        space = 8 + ChannelState::INIT_SPACE,
        seeds=[b"channel", leecher.key().as_ref(), seeder.key().as_ref(), channel_id.as_ref()], // channel_id binds the session 
        bump
    )]
    pub channel_state: Account<'info, ChannelState>,

    // escrow token account PDA - holds the deposited USDC
    #[account(
        init,
        payer=leecher,
        seeds=[b"escrow", channel_state.key().as_ref()],
        bump,
        token::mint=mint,
        token::authority=authority
    )]
    pub escrow: Account<'info, TokenAccount>,

    // leecher's USDC token account 
    #[account(
        mut,
        token::mint=mint,
        token::authority=leecher,
    )]
    pub leecher_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>, // USDC mint

    // global authority PDA - owns all escrow token accounts
    /// CHECK: this is a PDA used only as a signing authority. No data stored.
    #[account(
        seeds=[b"authority"],
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn open_channel_handler(
    ctx: Context<OpenChannel>,
    channel_id: [u8; 32],
    amount: u64,
    timeout_seconds: i64,
) -> Result<()> {
    // validate params
    require!(amount > 0, SeedPayError::ZeroDeposit);
    require!(timeout_seconds >= 3600, SeedPayError::TimeoutTooShort);
    require!(timeout_seconds <= 604800, SeedPayError::TimeoutTooLong);

    // current time
    let clock = Clock::get()?;

    // initialize the channel state
    ctx.accounts.channel_state.set_inner(ChannelState {
        leecher: ctx.accounts.leecher.key(),
        seeder: ctx.accounts.seeder.key(),
        deposited: amount,
        channel_id,
        created_at: clock.unix_timestamp,
        timeout: clock.unix_timestamp + timeout_seconds,
        last_nonce: 0,
        status: ChannelStatus::Open,
        bump: ctx.bumps.channel_state,
    });

    // transfer USDC from leecher -> escrow
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.leecher_token_account.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
            authority: ctx.accounts.leecher.to_account_info()
        },
    );
    transfer(transfer_ctx, amount)?;

    emit!(ChannelOpened {
        leecher: ctx.accounts.leecher.key(),
        seeder: ctx.accounts.seeder.key(),
        channel_id,
        deposited: amount,
        timeout: ctx.accounts.channel_state.timeout,
    });

    Ok(())
}