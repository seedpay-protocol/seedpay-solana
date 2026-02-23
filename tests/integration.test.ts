import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { before, describe, it } from "mocha";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Seedpay } from "../target/types/seedpay";
import {
  ACCOUNT_SIZE,
  createInitializeAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";

// SDK imports — the whole point of this test
import {
  generateEphemeralKeypair,
  deriveSessionKeys,
  signPaymentCheck,
  verifyPaymentCheck,
  ChannelClient,
} from "../packages/sdk/src";

describe("integration: SDK-driven happy path", () => {
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = BigInt(10_000_000); // 10 USDC
  const PRICE_PER_MB = 100; // 0.0001 USDC in base units
  const TIMEOUT_SECONDS = 3600;

  let provider: BankrunProvider;
  let program: Program<Seedpay>;
  let client: ChannelClient;
  let context: Awaited<ReturnType<typeof startAnchor>>;

  let leecher: anchor.Wallet;
  let seeder: Keypair;
  let usdcMint: PublicKey;
  let leecherTokenAccount: PublicKey;
  let seederTokenAccount: PublicKey;

  // ECDH-derived channel binding
  let channelId: Uint8Array;

  before(async () => {
    // ── Bootstrap bankrun environment ──────────────────
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new Program<Seedpay>(anchor.workspace.seedpay.idl, provider);
    client = new ChannelClient(program);

    leecher = provider.wallet as anchor.Wallet;
    seeder = Keypair.generate();

    const rent = await context.banksClient.getRent();

    // ── Create mock USDC mint ─────────────────────────
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
        createInitializeMint2Instruction(
          usdcMint,
          USDC_DECIMALS,
          leecher.publicKey,
          null,
        ),
      ),
      [mintKeypair],
    );

    // ── Create token accounts ─────────────────────────
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
        createInitializeAccountInstruction(
          leecherTokenAccount,
          usdcMint,
          leecher.publicKey,
        ),
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
        createInitializeAccountInstruction(
          seederTokenAccount,
          usdcMint,
          seeder.publicKey,
        ),
      ),
      [seederAtaKp],
    );

    // ── Mint USDC to leecher ──────────────────────────
    await provider.sendAndConfirm!(
      new Transaction().add(
        createMintToInstruction(
          usdcMint,
          leecherTokenAccount,
          leecher.publicKey,
          100 * 10 ** USDC_DECIMALS, // 100 USDC
        ),
      ),
      [],
    );

    // ── ECDH key exchange (simulated between two peers) ──
    const leecherEphemeral = generateEphemeralKeypair();
    const seederEphemeral = generateEphemeralKeypair();

    const leecherSession = deriveSessionKeys(
      leecherEphemeral.secretKey,
      seederEphemeral.publicKey,
    );
    const seederSession = deriveSessionKeys(
      seederEphemeral.secretKey,
      leecherEphemeral.publicKey,
    );

    // Sanity: both sides derived the same channel ID
    assert.deepEqual(
      Array.from(leecherSession.channelId),
      Array.from(seederSession.channelId),
    );

    channelId = leecherSession.channelId;
  });

  it("full flow: ECDH → open → sign 3 checks → close with highest → verify balances", async () => {
    const leecherBefore = await getAccount(
      provider.connection,
      leecherTokenAccount,
    );
    const seederBefore = await getAccount(
      provider.connection,
      seederTokenAccount,
    );

    // ── 1. Open channel via SDK ───────────────────────
    const { txSignature: openTx, pdas } = await client.openChannel({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      amount: DEPOSIT_AMOUNT,
      timeoutSeconds: TIMEOUT_SECONDS,
      leecherTokenAccount,
      mint: usdcMint,
    });
    assert.ok(openTx, "open_channel tx should succeed");

    // ── 2. Verify channel state on-chain ──────────────
    const channel = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.ok(channel, "channel should exist");
    assert.equal(channel!.status, "open");
    assert.equal(channel!.deposited, DEPOSIT_AMOUNT);
    assert.equal(channel!.lastNonce, BigInt(0));

    // ── 3. Simulate data transfer with 3 payment checks ──
    // Simulating: 10MB, 30MB, 50MB downloaded at 0.0001 USDC/MB
    const checks = [
      signPaymentCheck(
        channelId,
        BigInt(1_000),
        BigInt(1),
        leecher.payer.secretKey,
      ), // 10MB  = 0.001 USDC
      signPaymentCheck(
        channelId,
        BigInt(3_000),
        BigInt(2),
        leecher.payer.secretKey,
      ), // 30MB  = 0.003 USDC
      signPaymentCheck(
        channelId,
        BigInt(5_000),
        BigInt(3),
        leecher.payer.secretKey,
      ), // 50MB  = 0.005 USDC
    ];

    // Seeder validates each check off-chain
    for (const check of checks) {
      assert.isTrue(
        verifyPaymentCheck(check, leecher.payer.publicKey.toBytes()),
        "seeder should validate check off-chain",
      );
    }

    // Amounts are monotonically increasing
    assert.isTrue(checks[1].amount > checks[0].amount);
    assert.isTrue(checks[2].amount > checks[1].amount);

    // ── 4. Close channel with highest check via SDK ───
    const highestCheck = checks[checks.length - 1];

    const { txSignature: closeTx } = await client.closeChannel({
      seeder,
      leecher: leecher.publicKey,
      channelId,
      amount: highestCheck.amount,
      nonce: highestCheck.nonce,
      signature: highestCheck.signature,
      seederTokenAccount,
      leecherTokenAccount,
    });
    assert.ok(closeTx, "close_channel tx should succeed");

    // ── 5. Verify final balances ──────────────────────
    // leecherBefore was captured BEFORE open_channel, so the full cycle is:
    //   before → (open: -deposit) → (close: +refund) → after
    // Net leecher spend = deposit - refund = claimed amount
    // Net seeder gain = claimed amount
    const leecherAfter = await getAccount(
      provider.connection,
      leecherTokenAccount,
    );
    const seederAfter = await getAccount(
      provider.connection,
      seederTokenAccount,
    );

    const seederEarned =
      Number(seederAfter.amount) - Number(seederBefore.amount);
    const leecherNetSpent =
      Number(leecherBefore.amount) - Number(leecherAfter.amount);

    assert.equal(
      seederEarned,
      Number(highestCheck.amount),
      "seeder should earn check amount",
    );
    assert.equal(
      leecherNetSpent,
      Number(highestCheck.amount),
      "leecher net spend should equal claimed amount",
    );

    // Conservation: what seeder earned + what leecher got back = total deposit
    const leecherRefund = Number(DEPOSIT_AMOUNT) - leecherNetSpent;
    assert.equal(
      seederEarned + leecherRefund,
      Number(DEPOSIT_AMOUNT),
      "seeder earned + leecher refund = deposit",
    );

    // ── 6. Channel should be closed ───────────────────
    const closedChannel = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.isNull(
      closedChannel,
      "channel account should be deleted after close",
    );
  });
});

describe("integration: SDK-driven timeout path", () => {
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = BigInt(5_000_000); // 5 USDC
  const TIMEOUT_SECONDS = 3600;

  let provider: BankrunProvider;
  let program: Program<Seedpay>;
  let client: ChannelClient;
  let context: Awaited<ReturnType<typeof startAnchor>>;

  let leecher: anchor.Wallet;
  let seeder: Keypair;
  let usdcMint: PublicKey;
  let leecherTokenAccount: PublicKey;
  let channelId: Uint8Array;

  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new Program<Seedpay>(anchor.workspace.seedpay.idl, provider);
    client = new ChannelClient(program);

    leecher = provider.wallet as anchor.Wallet;
    seeder = Keypair.generate();

    const rent = await context.banksClient.getRent();

    // Create mint
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
        createInitializeMint2Instruction(
          usdcMint,
          USDC_DECIMALS,
          leecher.publicKey,
          null,
        ),
      ),
      [mintKeypair],
    );

    // Create leecher token account
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
        createInitializeAccountInstruction(
          leecherTokenAccount,
          usdcMint,
          leecher.publicKey,
        ),
      ),
      [leecherAtaKp],
    );

    // Mint USDC
    await provider.sendAndConfirm!(
      new Transaction().add(
        createMintToInstruction(
          usdcMint,
          leecherTokenAccount,
          leecher.publicKey,
          100 * 10 ** USDC_DECIMALS,
        ),
      ),
      [],
    );

    // ECDH
    const leecherEph = generateEphemeralKeypair();
    const seederEph = generateEphemeralKeypair();
    const session = deriveSessionKeys(
      leecherEph.secretKey,
      seederEph.publicKey,
    );
    channelId = session.channelId;

    // Open channel via SDK
    await client.openChannel({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      amount: DEPOSIT_AMOUNT,
      timeoutSeconds: TIMEOUT_SECONDS,
      leecherTokenAccount,
      mint: usdcMint,
    });
  });

  it("full timeout flow: ECDH → open → warp time → timeout_close → verify full refund", async () => {
    const leecherBefore = await getAccount(
      provider.connection,
      leecherTokenAccount,
    );

    // Verify channel is open
    const channel = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.ok(channel);
    assert.equal(channel!.status, "open");

    // Warp clock past timeout
    const clock = await context.banksClient.getClock();
    const warpedSlot = clock.slot + BigInt(TIMEOUT_SECONDS * 2);
    context.warpToSlot(warpedSlot);
    context.setClock(
      new Clock(
        warpedSlot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(TIMEOUT_SECONDS + 1),
      ),
    );

    // Timeout close via SDK
    const { txSignature } = await client.timeoutClose({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      leecherTokenAccount,
    });
    assert.ok(txSignature, "timeout_close tx should succeed");

    // Verify full refund
    const leecherAfter = await getAccount(
      provider.connection,
      leecherTokenAccount,
    );
    const refunded = Number(leecherAfter.amount) - Number(leecherBefore.amount);
    assert.equal(
      refunded,
      Number(DEPOSIT_AMOUNT),
      "leecher should get full deposit back",
    );

    // Channel should be gone
    const closedChannel = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.isNull(
      closedChannel,
      "channel account should be deleted after timeout",
    );
  });
});
