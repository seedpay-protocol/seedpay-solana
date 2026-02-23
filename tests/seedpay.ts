import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { before, describe, it } from "mocha";
import { Ed25519Program, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Seedpay } from "../target/types/seedpay";
import * as crypto from "crypto";
import {
  ACCOUNT_SIZE,
  createAccount,
  createInitializeAccountInstruction,
  createInitializeMint2Instruction,
  createMint,
  createMintToInstruction,
  getAccount,
  MINT_SIZE,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";

describe("seedpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.seedpay as Program<Seedpay>;
  const connection = provider.connection;

  const leecher = provider.wallet as anchor.Wallet;
  const seeder = Keypair.generate();

  let usdcMint: PublicKey;
  let leecherTokenAccount: PublicKey;
  let seederTokenAccount: PublicKey;
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1_000_000; // 1 USDC

  const channelId = Array.from(crypto.randomBytes(32));
  const timeoutSeconds = new anchor.BN(3600);

  let channelStatePda: PublicKey;
  let escrowPda: PublicKey;

  before(async () => {
    const airdropSig = await connection.requestAirdrop(
      seeder.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(airdropSig);

    usdcMint = await createMint(
      connection,
      leecher.payer,
      leecher.publicKey,
      null,
      USDC_DECIMALS,
    );

    leecherTokenAccount = await createAccount(
      connection,
      leecher.payer,
      usdcMint,
      leecher.publicKey,
    );

    seederTokenAccount = await createAccount(
      connection,
      leecher.payer,
      usdcMint,
      seeder.publicKey,
    );

    await mintTo(
      connection,
      leecher.payer,
      usdcMint,
      leecherTokenAccount,
      leecher.publicKey,
      100 * 10 ** USDC_DECIMALS,
    );

    [channelStatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("channel"),
        leecher.publicKey.toBuffer(),
        seeder.publicKey.toBuffer(),
        Buffer.from(channelId),
      ],
      program.programId,
    );

    [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), channelStatePda.toBuffer()],
      program.programId,
    );
  });

  it("opens a payment channel", async () => {
    const leecherBefore = await getAccount(connection, leecherTokenAccount);

    await program.methods
      .openChannel(channelId, new anchor.BN(DEPOSIT_AMOUNT), timeoutSeconds)
      .accounts({
        leecher: leecher.publicKey,
        seeder: seeder.publicKey,
        leecherTokenAccount,
        mint: usdcMint,
      })
      .rpc();

    const channelState = await program.account.channelState.fetch(channelStatePda);
    assert.ok(channelState.leecher.equals(leecher.publicKey));
    assert.ok(channelState.seeder.equals(seeder.publicKey));
    assert.equal(channelState.deposited.toNumber(), DEPOSIT_AMOUNT);
    assert.deepEqual(channelState.channelId, channelId);
    assert.equal(channelState.lastNonce.toNumber(), 0);
    assert.deepEqual(channelState.status, { open: {} });

    const escrowAccount = await getAccount(connection, escrowPda);
    assert.equal(Number(escrowAccount.amount), DEPOSIT_AMOUNT);

    const leecherAfter = await getAccount(connection, leecherTokenAccount);
    assert.equal(
      Number(leecherBefore.amount) - Number(leecherAfter.amount),
      DEPOSIT_AMOUNT,
    );
  });

  it("closes a payment channel with Ed25519 signed check", async () => {
    const CLAIM_AMOUNT = 600_000; // 0.6 USDC
    const NONCE = 1;
    const REFUND_AMOUNT = DEPOSIT_AMOUNT - CLAIM_AMOUNT;

    const seederBefore = await getAccount(connection, seederTokenAccount);
    const leecherBefore = await getAccount(connection, leecherTokenAccount);

    // payment check message: channel_id (32) || amount (8 LE) || nonce (8 LE)
    const message = Buffer.alloc(48);
    Buffer.from(channelId).copy(message, 0);
    message.writeBigUInt64LE(BigInt(CLAIM_AMOUNT), 32);
    message.writeBigUInt64LE(BigInt(NONCE), 40);

    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: leecher.payer.secretKey,
      message: Uint8Array.from(message),
    });

    await program.methods
      .closeChannel(new anchor.BN(CLAIM_AMOUNT), new anchor.BN(NONCE))
      .accountsPartial({
        seeder: seeder.publicKey,
        leecher: leecher.publicKey,
        channelState: channelStatePda,
        seederTokenAccount,
        leecherTokenAccount,
      })
      .preInstructions([ed25519Ix])
      .signers([seeder])
      .rpc();

    const seederAfter = await getAccount(connection, seederTokenAccount);
    assert.equal(
      Number(seederAfter.amount) - Number(seederBefore.amount),
      CLAIM_AMOUNT,
    );

    const leecherAfter = await getAccount(connection, leecherTokenAccount);
    assert.equal(
      Number(leecherAfter.amount) - Number(leecherBefore.amount),
      REFUND_AMOUNT,
    );

    // channel state and escrow should be closed
    try {
      await program.account.channelState.fetch(channelStatePda);
      assert.fail("Channel state should be closed");
    } catch (err: any) {
      assert.include(err.message, "Account does not exist or has no data");
    }

    try {
      await getAccount(connection, escrowPda);
      assert.fail("Escrow should be closed");
    } catch {
      // expected: TokenAccountNotFoundError
    }
  });
});

describe("seedpay - timeout_close", () => {
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1_000_000;
  const TIMEOUT_SECONDS = 3600;

  const channelId = Array.from(crypto.randomBytes(32));

  let provider: BankrunProvider;
  let program: Program<Seedpay>;
  let context: Awaited<ReturnType<typeof startAnchor>>;

  let leecher: anchor.Wallet;
  let seeder: Keypair;
  let usdcMint: PublicKey;
  let leecherTokenAccount: PublicKey;
  let channelStatePda: PublicKey;
  let escrowPda: PublicKey;

  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new Program<Seedpay>(
      anchor.workspace.seedpay.idl,
      provider,
    );

    leecher = provider.wallet as anchor.Wallet;
    seeder = Keypair.generate();

    const rent = await context.banksClient.getRent();

    // create mint
    const mintKeypair = Keypair.generate();
    usdcMint = mintKeypair.publicKey;
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: leecher.publicKey,
        newAccountPubkey: usdcMint,
        space: MINT_SIZE,
        lamports: Number(rent.minimumBalance(BigInt(MINT_SIZE))),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(usdcMint, USDC_DECIMALS, leecher.publicKey, null),
    );
    await provider.sendAndConfirm!(createMintTx, [mintKeypair]);

    // create leecher token account
    const leecherAtaKeypair = Keypair.generate();
    leecherTokenAccount = leecherAtaKeypair.publicKey;
    const createAtaTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: leecher.publicKey,
        newAccountPubkey: leecherTokenAccount,
        space: ACCOUNT_SIZE,
        lamports: Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE))),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccountInstruction(leecherTokenAccount, usdcMint, leecher.publicKey),
    );
    await provider.sendAndConfirm!(createAtaTx, [leecherAtaKeypair]);

    // mint USDC to leecher
    const mintToTx = new Transaction().add(
      createMintToInstruction(usdcMint, leecherTokenAccount, leecher.publicKey, 100 * 10 ** USDC_DECIMALS),
    );
    await provider.sendAndConfirm!(mintToTx, []);

    [channelStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), leecher.publicKey.toBuffer(), seeder.publicKey.toBuffer(), Buffer.from(channelId)],
      program.programId,
    );

    [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), channelStatePda.toBuffer()],
      program.programId,
    );

    await program.methods
      .openChannel(channelId, new anchor.BN(DEPOSIT_AMOUNT), new anchor.BN(TIMEOUT_SECONDS))
      .accounts({
        leecher: leecher.publicKey,
        seeder: seeder.publicKey,
        leecherTokenAccount,
        mint: usdcMint,
      })
      .rpc();
  });

  it("rejects timeout_close before timeout", async () => {
    try {
      await program.methods
        .timeoutClose()
        .accountsPartial({
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          leecherTokenAccount,
        })
        .rpc();
      assert.fail("Should have rejected early timeout_close");
    } catch (err: any) {
      assert.include(err.message, "Timeout has not passed");
    }
  });

  it("refunds leecher after timeout", async () => {
    const leecherBefore = await getAccount(provider.connection, leecherTokenAccount);

    // warp clock and slot past the timeout
    const clock = await context.banksClient.getClock();
    const warpedSlot = clock.slot + BigInt(TIMEOUT_SECONDS * 2);
    context.warpToSlot(warpedSlot);
    const newClock = new Clock(
      warpedSlot,
      clock.epochStartTimestamp,
      clock.epoch,
      clock.leaderScheduleEpoch,
      clock.unixTimestamp + BigInt(TIMEOUT_SECONDS + 1),
    );
    context.setClock(newClock);

    await program.methods
      .timeoutClose()
      .accountsPartial({
        leecher: leecher.publicKey,
        channelState: channelStatePda,
        leecherTokenAccount,
      })
      .rpc();

    const leecherAfter = await getAccount(provider.connection, leecherTokenAccount);
    assert.equal(
      Number(leecherAfter.amount) - Number(leecherBefore.amount),
      DEPOSIT_AMOUNT,
    );

    // channel state and escrow should be closed
    try {
      await program.account.channelState.fetch(channelStatePda);
      assert.fail("Channel state should be closed");
    } catch (err: any) {
      assert.ok(err.message !== "Channel state should be closed");
    }

    try {
      await getAccount(provider.connection, escrowPda);
      assert.fail("Escrow should be closed");
    } catch {
      // expected: TokenAccountNotFoundError
    }
  });
});

describe("seedpay - error cases", () => {
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1_000_000;
  const TIMEOUT_SECONDS = 3600;

  let provider: BankrunProvider;
  let program: Program<Seedpay>;
  let context: Awaited<ReturnType<typeof startAnchor>>;
  let leecher: anchor.Wallet;
  let seeder: Keypair;
  let usdcMint: PublicKey;
  let leecherTokenAccount: PublicKey;
  let seederTokenAccount: PublicKey;

  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new Program<Seedpay>(anchor.workspace.seedpay.idl, provider);

    leecher = provider.wallet as anchor.Wallet;
    seeder = Keypair.generate();

    const rent = await context.banksClient.getRent();

    const mintKeypair = Keypair.generate();
    usdcMint = mintKeypair.publicKey;
    await provider.sendAndConfirm!(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: leecher.publicKey,
          newAccountPubkey: usdcMint,
          space: MINT_SIZE,
          lamports: Number(rent.minimumBalance(BigInt(MINT_SIZE))),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(usdcMint, USDC_DECIMALS, leecher.publicKey, null),
      ),
      [mintKeypair],
    );

    const leecherAtaKp = Keypair.generate();
    leecherTokenAccount = leecherAtaKp.publicKey;
    await provider.sendAndConfirm!(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: leecher.publicKey,
          newAccountPubkey: leecherTokenAccount,
          space: ACCOUNT_SIZE,
          lamports: Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE))),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(leecherTokenAccount, usdcMint, leecher.publicKey),
      ),
      [leecherAtaKp],
    );

    const seederAtaKp = Keypair.generate();
    seederTokenAccount = seederAtaKp.publicKey;
    await provider.sendAndConfirm!(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: leecher.publicKey,
          newAccountPubkey: seederTokenAccount,
          space: ACCOUNT_SIZE,
          lamports: Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE))),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(seederTokenAccount, usdcMint, seeder.publicKey),
      ),
      [seederAtaKp],
    );

    await provider.sendAndConfirm!(
      new Transaction().add(
        createMintToInstruction(usdcMint, leecherTokenAccount, leecher.publicKey, 100 * 10 ** USDC_DECIMALS),
      ),
      [],
    );
  });

  async function openChannel() {
    const channelId = Array.from(crypto.randomBytes(32));
    const [channelStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("channel"), leecher.publicKey.toBuffer(), seeder.publicKey.toBuffer(), Buffer.from(channelId)],
      program.programId,
    );
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), channelStatePda.toBuffer()],
      program.programId,
    );
    await program.methods
      .openChannel(channelId, new anchor.BN(DEPOSIT_AMOUNT), new anchor.BN(TIMEOUT_SECONDS))
      .accounts({ leecher: leecher.publicKey, seeder: seeder.publicKey, leecherTokenAccount, mint: usdcMint })
      .rpc();
    return { channelId, channelStatePda, escrowPda };
  }

  function buildCheck(channelId: number[], amount: number, nonce: number): Buffer {
    const msg = Buffer.alloc(48);
    Buffer.from(channelId).copy(msg, 0);
    msg.writeBigUInt64LE(BigInt(amount), 32);
    msg.writeBigUInt64LE(BigInt(nonce), 40);
    return msg;
  }

  // ── open_channel errors ───────────────────────────────

  it("open_channel: rejects zero deposit", async () => {
    const channelId = Array.from(crypto.randomBytes(32));
    try {
      await program.methods
        .openChannel(channelId, new anchor.BN(0), new anchor.BN(TIMEOUT_SECONDS))
        .accounts({ leecher: leecher.publicKey, seeder: seeder.publicKey, leecherTokenAccount, mint: usdcMint })
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "Deposite amount must be greater than zero");
    }
  });

  it("open_channel: rejects timeout too short", async () => {
    const channelId = Array.from(crypto.randomBytes(32));
    try {
      await program.methods
        .openChannel(channelId, new anchor.BN(DEPOSIT_AMOUNT), new anchor.BN(3599))
        .accounts({ leecher: leecher.publicKey, seeder: seeder.publicKey, leecherTokenAccount, mint: usdcMint })
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "Timeout duration too short");
    }
  });

  it("open_channel: rejects timeout too long", async () => {
    const channelId = Array.from(crypto.randomBytes(32));
    try {
      await program.methods
        .openChannel(channelId, new anchor.BN(DEPOSIT_AMOUNT), new anchor.BN(604801))
        .accounts({ leecher: leecher.publicKey, seeder: seeder.publicKey, leecherTokenAccount, mint: usdcMint })
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "Timeout duration too long");
    }
  });

  // ── close_channel errors ──────────────────────────────

  it("close_channel: rejects wrong seeder", async () => {
    const { channelId, channelStatePda } = await openChannel();
    const wrongSeeder = Keypair.generate();

    const msg = buildCheck(channelId, 500_000, 1);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: leecher.payer.secretKey,
      message: Uint8Array.from(msg),
    });

    try {
      await program.methods
        .closeChannel(new anchor.BN(500_000), new anchor.BN(1))
        .accountsPartial({
          seeder: wrongSeeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .preInstructions([ed25519Ix])
        .signers([wrongSeeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "UnauthorizedSeeder");
    }
  });

  it("close_channel: rejects stale nonce", async () => {
    const { channelId, channelStatePda } = await openChannel();

    const msg = buildCheck(channelId, 500_000, 0);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: leecher.payer.secretKey,
      message: Uint8Array.from(msg),
    });

    try {
      await program.methods
        .closeChannel(new anchor.BN(500_000), new anchor.BN(0))
        .accountsPartial({
          seeder: seeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .preInstructions([ed25519Ix])
        .signers([seeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "StaleNonce");
    }
  });

  it("close_channel: rejects amount exceeds deposit", async () => {
    const { channelId, channelStatePda } = await openChannel();
    const overAmount = DEPOSIT_AMOUNT + 1;

    const msg = buildCheck(channelId, overAmount, 1);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: leecher.payer.secretKey,
      message: Uint8Array.from(msg),
    });

    try {
      await program.methods
        .closeChannel(new anchor.BN(overAmount), new anchor.BN(1))
        .accountsPartial({
          seeder: seeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .preInstructions([ed25519Ix])
        .signers([seeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "AmountExceedsDeposit");
    }
  });

  it("close_channel: rejects missing Ed25519 instruction", async () => {
    const { channelStatePda } = await openChannel();

    try {
      await program.methods
        .closeChannel(new anchor.BN(500_000), new anchor.BN(1))
        .accountsPartial({
          seeder: seeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .signers([seeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "MissingEd25519Instruction");
    }
  });

  it("close_channel: rejects signer mismatch", async () => {
    const { channelId, channelStatePda } = await openChannel();

    // sign with seeder's key instead of leecher's
    const msg = buildCheck(channelId, 500_000, 1);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: seeder.secretKey,
      message: Uint8Array.from(msg),
    });

    try {
      await program.methods
        .closeChannel(new anchor.BN(500_000), new anchor.BN(1))
        .accountsPartial({
          seeder: seeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .preInstructions([ed25519Ix])
        .signers([seeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "SignerMismatch");
    }
  });

  it("close_channel: rejects message mismatch", async () => {
    const { channelId, channelStatePda } = await openChannel();

    // sign check for 500_000 but submit with 400_000
    const msg = buildCheck(channelId, 500_000, 1);
    const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: leecher.payer.secretKey,
      message: Uint8Array.from(msg),
    });

    try {
      await program.methods
        .closeChannel(new anchor.BN(400_000), new anchor.BN(1))
        .accountsPartial({
          seeder: seeder.publicKey,
          leecher: leecher.publicKey,
          channelState: channelStatePda,
          seederTokenAccount,
          leecherTokenAccount,
        })
        .preInstructions([ed25519Ix])
        .signers([seeder])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "MessageMismatch");
    }
  });

  // ── timeout_close errors ──────────────────────────────

  it("timeout_close: rejects wrong leecher", async () => {
    const { channelStatePda } = await openChannel();
    const wrongLeecher = Keypair.generate();

    try {
      await program.methods
        .timeoutClose()
        .accountsPartial({
          leecher: wrongLeecher.publicKey,
          channelState: channelStatePda,
          leecherTokenAccount,
        })
        .signers([wrongLeecher])
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      assert.include(err.message, "UnauthorizedLeecher");
    }
  });

  it("timeout_close: rejects already closed channel", async () => {
    const { channelStatePda } = await openChannel();

    // warp past timeout and close
    const clock = await context.banksClient.getClock();
    const warpedSlot = clock.slot + BigInt(TIMEOUT_SECONDS * 2);
    context.warpToSlot(warpedSlot);
    context.setClock(
      new Clock(warpedSlot, clock.epochStartTimestamp, clock.epoch, clock.leaderScheduleEpoch, clock.unixTimestamp + BigInt(TIMEOUT_SECONDS + 1)),
    );

    await program.methods
      .timeoutClose()
      .accountsPartial({ leecher: leecher.publicKey, channelState: channelStatePda, leecherTokenAccount })
      .rpc();

    // advance slot for fresh blockhash
    const clock2 = await context.banksClient.getClock();
    context.warpToSlot(clock2.slot + BigInt(100));

    // try closing again
    try {
      await program.methods
        .timeoutClose()
        .accountsPartial({ leecher: leecher.publicKey, channelState: channelStatePda, leecherTokenAccount })
        .rpc();
      assert.fail("Should have rejected");
    } catch (err: any) {
      // channel_state account was deleted by close = leecher
      assert.ok(err.message !== "Should have rejected");
    }
  });
});
