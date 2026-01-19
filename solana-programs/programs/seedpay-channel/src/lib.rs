use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use sha2::{Digest, Sha256};
use anchor_lang::solana_program::sysvar::instructions::get_instruction_relative;

pub mod errors;
pub mod events;
pub mod state;

use errors::SeedPayError;
use events::{ChannelClosed, ChannelOpened, ChannelTimedOut};
use state::{ChannelStatus, PaymentChannel};

declare_id!("SEEDPAY111111111111111111111111111111111111");

// Native Solana Ed25519 program ID
const ED25519_PROGRAM_ID: anchor_lang::solana_program::pubkey::Pubkey = 
    anchor_lang::solana_program::pubkey::Pubkey::new_from_array([
        92, 178, 185, 144,  49, 200, 236, 184,
        111,  79, 248, 246,  67, 135,  24, 227,
        212,  62, 222,  48, 234, 128,  52,  45,
        244, 101, 219, 146, 167,  27, 153,  59,
    ]);

#[program]
pub mod seedpay_channel {
    use super::*;

    pub fn open_channel(
        ctx: Context<OpenChannel>,
        amount: u64,
        timeout_seconds: i64,
        session_hash: [u8; 32],
    ) -> Result<()> {
        require!(timeout_seconds >= 3600, SeedPayError::TimeoutTooShort);
        require!(amount > 0, SeedPayError::DepositTooLow);
        require!(
            session_hash.iter().any(|&b| b != 0),
            SeedPayError::InvalidSessionHash
        );

        let clock = Clock::get()?;
        let channel = &mut ctx.accounts.channel;

        channel.leecher = ctx.accounts.leecher.key();
        channel.seeder = ctx.accounts.seeder.key();
        channel.escrow = ctx.accounts.escrow.key();
        channel.mint = ctx.accounts.mint.key();
        channel.deposited = amount;
        channel.created_at = clock.unix_timestamp;
        channel.timeout = clock.unix_timestamp + timeout_seconds;
        channel.session_hash = session_hash;
        channel.last_nonce = 0;
        channel.last_amount = 0;
        channel.status = ChannelStatus::Open;
        channel.bump = ctx.bumps.channel;
        channel.escrow_bump = ctx.bumps.escrow;

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.leecher_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
            authority: ctx.accounts.leecher.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(ChannelOpened {
            channel: channel.key(),
            leecher: channel.leecher,
            seeder: channel.seeder,
            amount,
            timeout: channel.timeout,
            session_hash,
        });

        Ok(())
    }

    pub fn close_channel(
        ctx: Context<CloseChannel>,
        amount: u64,
        nonce: u64,
        signature: [u8; 64],
    ) -> Result<()> {
        let channel_info = ctx.accounts.channel.to_account_info();
        let escrow_info = ctx.accounts.escrow.to_account_info();
        let mint_info = ctx.accounts.mint.to_account_info();
        let seeder_token_info = ctx.accounts.seeder_token_account.to_account_info();
        let leecher_token_info = ctx.accounts.leecher_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let decimals = ctx.accounts.mint.decimals;

        let channel = &mut ctx.accounts.channel;

        require!(nonce > channel.last_nonce, SeedPayError::StaleNonce);
        require!(
            amount <= channel.deposited,
            SeedPayError::AmountExceedsDeposit
        );
        require!(
            amount >= channel.last_amount,
            SeedPayError::AmountNotIncreasing
        );

        let message = create_payment_check_message(&channel.key(), amount, nonce);
        require!(
            verify_ed25519_signature_via_sysvar(
                &ctx.accounts.instruction_sysvar,
                &channel.leecher,
                &message,
                &signature
            ),
            SeedPayError::InvalidSignature
        );

        let deposited = channel.deposited;
        let leecher = channel.leecher;
        let seeder = channel.seeder;
        let session_hash = channel.session_hash;
        let channel_bump = channel.bump;

        // Channel PDA signs for escrow transfers
        let seeds = &[
            PaymentChannel::SEED_PREFIX,
            leecher.as_ref(),
            seeder.as_ref(),
            &session_hash,
            &[channel_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        if amount > 0 {
            let cpi_accounts = TransferChecked {
                from: escrow_info.clone(),
                mint: mint_info.clone(),
                to: seeder_token_info,
                authority: channel_info.clone(),
            };
            let cpi_ctx =
                CpiContext::new_with_signer(token_program_info.clone(), cpi_accounts, signer_seeds);
            transfer_checked(cpi_ctx, amount, decimals)?;
        }

        let refund = deposited.saturating_sub(amount);
        if refund > 0 {
            let cpi_accounts = TransferChecked {
                from: escrow_info,
                mint: mint_info,
                to: leecher_token_info,
                authority: channel_info,
            };
            let cpi_ctx =
                CpiContext::new_with_signer(token_program_info, cpi_accounts, signer_seeds);
            transfer_checked(cpi_ctx, refund, decimals)?;
        }

        let channel = &mut ctx.accounts.channel;
        channel.status = ChannelStatus::Closed;
        channel.last_nonce = nonce;
        channel.last_amount = amount;

        emit!(ChannelClosed {
            channel: channel.key(),
            seeder_amount: amount,
            leecher_refund: refund,
            final_nonce: nonce,
        });

        Ok(())
    }

    pub fn timeout_close(ctx: Context<TimeoutClose>) -> Result<()> {
        let channel_info = ctx.accounts.channel.to_account_info();
        let escrow_info = ctx.accounts.escrow.to_account_info();
        let mint_info = ctx.accounts.mint.to_account_info();
        let leecher_token_info = ctx.accounts.leecher_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let decimals = ctx.accounts.mint.decimals;

        let channel = &ctx.accounts.channel;
        let clock = Clock::get()?;

        require!(
            channel.is_expired(clock.unix_timestamp),
            SeedPayError::ChannelNotExpired
        );

        let refund_amount = channel.deposited;
        let leecher = channel.leecher;
        let seeder = channel.seeder;
        let session_hash = channel.session_hash;
        let channel_bump = channel.bump;

        // Channel PDA signs for escrow transfers
        let seeds = &[
            PaymentChannel::SEED_PREFIX,
            leecher.as_ref(),
            seeder.as_ref(),
            &session_hash,
            &[channel_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        if refund_amount > 0 {
            let cpi_accounts = TransferChecked {
                from: escrow_info,
                mint: mint_info,
                to: leecher_token_info,
                authority: channel_info,
            };
            let cpi_ctx =
                CpiContext::new_with_signer(token_program_info, cpi_accounts, signer_seeds);
            transfer_checked(cpi_ctx, refund_amount, decimals)?;
        }

        let channel = &mut ctx.accounts.channel;
        channel.status = ChannelStatus::TimedOut;

        emit!(ChannelTimedOut {
            channel: channel.key(),
            refunded: refund_amount,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, timeout_seconds: i64, session_hash: [u8; 32])]
pub struct OpenChannel<'info> {
    #[account(mut)]
    pub leecher: Signer<'info>,

    /// CHECK: Seeder is validated by the channel PDA seeds
    pub seeder: UncheckedAccount<'info>,

    #[account(
        init,
        payer = leecher,
        space = 8 + PaymentChannel::INIT_SPACE,
        seeds = [
            PaymentChannel::SEED_PREFIX,
            leecher.key().as_ref(),
            seeder.key().as_ref(),
            &session_hash
        ],
        bump
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        init,
        payer = leecher,
        token::mint = mint,
        token::authority = channel,
        seeds = [PaymentChannel::ESCROW_SEED_PREFIX, channel.key().as_ref()],
        bump
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = leecher_token_account.owner == leecher.key() @ SeedPayError::InvalidLeecherAccount,
        constraint = leecher_token_account.mint == mint.key()
    )]
    pub leecher_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseChannel<'info> {
    #[account(
        mut,
        constraint = closer.key() == channel.seeder @ SeedPayError::NotSeeder
    )]
    pub closer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            PaymentChannel::SEED_PREFIX,
            channel.leecher.as_ref(),
            channel.seeder.as_ref(),
            &channel.session_hash
        ],
        bump = channel.bump,
        constraint = channel.is_open() @ SeedPayError::ChannelNotOpen
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        mut,
        seeds = [PaymentChannel::ESCROW_SEED_PREFIX, channel.key().as_ref()],
        bump = channel.escrow_bump
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seeder_token_account.owner == channel.seeder @ SeedPayError::InvalidSeederAccount,
        constraint = seeder_token_account.mint == channel.mint
    )]
    pub seeder_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = leecher_token_account.owner == channel.leecher @ SeedPayError::InvalidLeecherAccount,
        constraint = leecher_token_account.mint == channel.mint
    )]
    pub leecher_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    
    /// CHECK: Instructions sysvar - Ed25519 verify instruction must precede this instruction
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TimeoutClose<'info> {
    #[account(
        mut,
        constraint = leecher.key() == channel.leecher @ SeedPayError::NotLeecher
    )]
    pub leecher: Signer<'info>,

    #[account(
        mut,
        seeds = [
            PaymentChannel::SEED_PREFIX,
            channel.leecher.as_ref(),
            channel.seeder.as_ref(),
            &channel.session_hash
        ],
        bump = channel.bump,
        constraint = channel.is_open() @ SeedPayError::ChannelNotOpen
    )]
    pub channel: Account<'info, PaymentChannel>,

    #[account(
        mut,
        seeds = [PaymentChannel::ESCROW_SEED_PREFIX, channel.key().as_ref()],
        bump = channel.escrow_bump
    )]
    pub escrow: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = leecher_token_account.owner == channel.leecher @ SeedPayError::InvalidLeecherAccount,
        constraint = leecher_token_account.mint == channel.mint
    )]
    pub leecher_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

fn create_payment_check_message(channel: &Pubkey, amount: u64, nonce: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(48);
    message.extend_from_slice(channel.as_ref());
    message.extend_from_slice(&amount.to_le_bytes());
    message.extend_from_slice(&nonce.to_le_bytes());
    message
}

fn verify_ed25519_signature_via_sysvar(
    instruction_sysvar: &AccountInfo,
    pubkey: &Pubkey,
    message: &[u8],
    signature: &[u8; 64],
) -> bool {
    // Protocol requires SHA-256 hashing before Ed25519 verification
    let mut hasher = Sha256::new();
    hasher.update(message);
    let message_hash = hasher.finalize();

    let instruction = match get_instruction_relative(-1, instruction_sysvar) {
        Ok(ix) => ix,
        Err(_) => return false,
    };

    if instruction.program_id != ED25519_PROGRAM_ID {
        return false;
    }

    // Ed25519 instruction format: 16-byte header with offsets, then data
    // Header: [num_sigs, padding, sig_offset, sig_ix_idx, pubkey_offset, pubkey_ix_idx, msg_offset, msg_size, msg_ix_idx]
    let data = instruction.data.as_slice();
    
    if data.len() < 16 + 64 + 32 + 32 {
        return false;
    }

    if data[0] != 1 {
        return false;
    }

    let sig_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    if sig_offset + 64 > data.len() 
        || pubkey_offset + 32 > data.len() 
        || msg_offset + msg_size > data.len() 
    {
        return false;
    }

    let ix_signature = &data[sig_offset..sig_offset + 64];
    let ix_pubkey = &data[pubkey_offset..pubkey_offset + 32];
    let ix_message = &data[msg_offset..msg_offset + msg_size];

    ix_signature == signature.as_slice()
        && ix_pubkey == pubkey.as_ref()
        && ix_message == message_hash.as_slice()
}
