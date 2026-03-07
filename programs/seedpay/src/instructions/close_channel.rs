use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as instructions_sysvar;
use anchor_spl::token::{close_account, transfer, CloseAccount, Token, TokenAccount, Transfer};
use solana_sdk_ids::ed25519_program;

use crate::errors::SeedPayError;
use crate::events::ChannelClosed;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    /// seeder claiming payment - must match channel_state.seeder.
    #[account(mut)]
    pub seeder: Signer<'info>,

    /// leecher's wallet — receives escrow rent and channel state rent.
    /// CHECK: Validated via has_one on channel_state. Only receives SOL rent.
    #[account(mut)]
    pub leecher: UncheckedAccount<'info>,

    /// channel state PDA — closed after settlement (rent returned to leecher).
    #[account(
        mut,
        close = leecher,
        seeds = [b"channel", channel_state.leecher.as_ref(), channel_state.seeder.as_ref(), channel_state.channel_id.as_ref()],
        bump = channel_state.bump,
        has_one = seeder @ SeedPayError::UnauthorizedSeeder,
        has_one = leecher,
        constraint = channel_state.status == ChannelStatus::Open @ SeedPayError::ChannelNotOpen,
    )]
    pub channel_state: Account<'info, ChannelState>,

    /// escrow token account holding the deposited USDC.
    #[account(
        mut,
        seeds = [b"escrow", channel_state.key().as_ref()],
        bump,
        token::authority = authority,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// seeder's USDC token account — receives earned amount.
    #[account(
        mut,
        token::authority = seeder,
    )]
    pub seeder_token_account: Account<'info, TokenAccount>,

    /// leecher's USDC token account — receives refund of unspent deposit.
    #[account(
        mut,
        token::authority = channel_state.leecher,
    )]
    pub leecher_token_account: Account<'info, TokenAccount>,

    /// global authority PDA — signs escrow transfers.
    /// CHECK: PDA used only as signing authority.
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    /// instructions sysvar — used to introspect the Ed25519 SigVerify instruction.
    /// CHECK: Address is validated against the known sysvar ID.
    #[account(address = instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn close_channel_handler(ctx: Context<CloseChannel>, amount: u64, nonce: u64) -> Result<()> {
    let channel = &ctx.accounts.channel_state;

    // validate params
    require!(amount <= channel.deposited, SeedPayError::AmountExceedsDeposit);
    require!(nonce > channel.last_nonce, SeedPayError::StaleNonce);

    // Ed25519 Signature Verification
    // the transaction MUST include an Ed25519 SigVerify instruction immediately
    // before this instruction, proving the leecher signed (channel_id || amount || nonce).
    verify_ed25519_signature(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &channel.leecher,
        &channel.channel_id,
        amount,
        nonce,
    )?;

    // capture values before account is closed
    let deposited = channel.deposited;
    let refund = deposited.checked_sub(amount).unwrap(); // safe: amount <= deposited checked above

    // token transfers
    let authority_seeds: &[&[u8]] = &[b"authority", &[ctx.bumps.authority]];
    let signer_seeds = &[authority_seeds];

    // transfer earned amount to seeder
    if amount > 0 {
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.seeder_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }

    // refund remainder to leecher
    if refund > 0 {
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.leecher_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
        )?;
    }

    // Close escrow token account (rent -> leecher)
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.leecher.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Update channel state (account is closed by `close = leecher` at exit)
    let channel = &mut ctx.accounts.channel_state;
    channel.last_nonce = nonce;
    channel.status = ChannelStatus::Closed;

    emit!(ChannelClosed {
        leecher: channel.leecher,
        seeder: channel.seeder,
        channel_id: channel.channel_id,
        seeder_earned: amount,
        leecher_refunded: refund,
        nonce,
    });

    Ok(())
}

/// Verify that the transaction includes an Ed25519 SigVerify instruction
/// immediately before this instruction, proving the leecher signed the
/// payment check message.
///
/// Ed25519 instruction data layout (single signature):
///   byte 0:     num_signatures (u8)
///   byte 1:     padding
///   bytes 2..16: Ed25519SignatureOffsets (7 x u16 = 14 bytes)
///   remaining:   pubkey, signature, and message at positions given by offsets
fn verify_ed25519_signature(
    instructions_sysvar_info: &AccountInfo,
    expected_signer: &Pubkey,
    channel_id: &[u8; 32],
    amount: u64,
    nonce: u64,
) -> Result<()> {
    // detrmine current instruction index so we can require the Ed25519
    // instruction immediately before it (allows compute-budget ixs to precede).
    let current_ix_index =
        instructions_sysvar::load_current_index_checked(instructions_sysvar_info)
            .map_err(|_| error!(SeedPayError::MissingEd25519Instruction))?;

    require!(current_ix_index > 0, SeedPayError::MissingEd25519Instruction);

    let ed25519_ix = instructions_sysvar::load_instruction_at_checked(
        (current_ix_index - 1) as usize,
        instructions_sysvar_info,
    )
    .map_err(|_| error!(SeedPayError::MissingEd25519Instruction))?;

    // must target the Ed25519 native program
    require_keys_eq!(
        ed25519_ix.program_id,
        ed25519_program::ID,
        SeedPayError::InvalidEd25519Program
    );

    // Ed25519 instruction must have no accounts
    require!(
        ed25519_ix.accounts.is_empty(),
        SeedPayError::InvalidEd25519Instruction
    );

    let data = &ed25519_ix.data;

    // min. size: 2-byte header + 14-byte offsets = 16 bytes
    require!(data.len() >= 16, SeedPayError::InvalidEd25519Instruction);

    // Exactly 1 signature
    require!(data[0] == 1, SeedPayError::InvalidEd25519Instruction);

    // ── Parse Ed25519SignatureOffsets (bytes 2..16) ───────────────
    //  [2..4]  signature_offset: u16
    //  [4..6]  signature_instruction_index: u16
    //  [6..8]  public_key_offset: u16
    //  [8..10] public_key_instruction_index: u16
    // [10..12] message_data_offset: u16
    // [12..14] message_data_size: u16
    // [14..16] message_instruction_index: u16

    let sig_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_index = u16::from_le_bytes([data[14], data[15]]);

    // all data must reside within the same Ed25519 instruction (index = u16::MAX).
    // this prevents cross-instruction data injection attacks where an attacker
    // references a different instruction's data for the pubkey or message.
    require!(
        sig_ix_index == u16::MAX && pk_ix_index == u16::MAX && msg_ix_index == u16::MAX,
        SeedPayError::InvalidEd25519Instruction
    );

    // validate bounds
    require!(
        pk_offset.checked_add(32).map_or(false, |end| data.len() >= end),
        SeedPayError::InvalidEd25519Instruction
    );
    require!(
        msg_offset.checked_add(msg_size).map_or(false, |end| data.len() >= end),
        SeedPayError::InvalidEd25519Instruction
    );

    // verify public key matches the leecher
    let ix_pubkey = &data[pk_offset..pk_offset + 32];
    require!(
        ix_pubkey == expected_signer.as_ref(),
        SeedPayError::SignerMismatch
    );

    // verify message matches the payment check
    // message layout: channel_id (32) || amount (8 LE) || nonce (8 LE) = 48 bytes
    const EXPECTED_MSG_LEN: usize = 48;
    require!(msg_size == EXPECTED_MSG_LEN, SeedPayError::MessageMismatch);

    let ix_message = &data[msg_offset..msg_offset + EXPECTED_MSG_LEN];

    let mut expected_message = [0u8; EXPECTED_MSG_LEN];
    expected_message[0..32].copy_from_slice(channel_id);
    expected_message[32..40].copy_from_slice(&amount.to_le_bytes());
    expected_message[40..48].copy_from_slice(&nonce.to_le_bytes());

    require!(
        ix_message == expected_message,
        SeedPayError::MessageMismatch
    );

    Ok(())
}
