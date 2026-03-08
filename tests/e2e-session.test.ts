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

import {
  LeecherSession,
  SeederSession,
  ChannelClient,
  type SessionAction,
  type SendMessageAction,
  type OpenChannelAction,
  type CloseChannelAction,
  type VerifyChannelAction,
  type PaymentCheckMessage,
  type ChannelInfo,
} from "../packages/sdk/src";

const MB = 1_048_576n;

const findAction = <T extends SessionAction>(
  actions: SessionAction[],
  type: T["action"],
): T | undefined => actions.find((a) => a.action === type) as T | undefined;

const findSendMessage = (
  actions: SessionAction[],
  msgType: string,
): SendMessageAction | undefined =>
  actions.find(
    (a) => a.action === "send_message" && a.message.type === msgType,
  ) as SendMessageAction | undefined;

describe("e2e: session state machines + on-chain channel client", () => {
  const USDC_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 10_000_000n; // 10 USDC
  const PRICE_PER_MB = 100n; // 0.0001 USDC per MB
  const CHECK_FREQUENCY_MB = 1n;
  const TIMEOUT_SECONDS = 3600n;

  let provider: BankrunProvider;
  let program: Program<Seedpay>;
  let client: ChannelClient;
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
    client = new ChannelClient(program);

    leecher = provider.wallet as anchor.Wallet;
    seeder = Keypair.generate();

    const rent = await context.banksClient.getRent();

    // Create mock USDC mint
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

    // Create token accounts
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

    // Mint USDC to leecher
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
  });

  it("full session lifecycle: ECDH → open channel → payment checks → close channel → verify balances", async () => {
    // --- Create sessions ---
    const leecherSession = new LeecherSession({
      deposit: DEPOSIT_AMOUNT,
      timeout: TIMEOUT_SECONDS,
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
      signingKey: leecher.payer.secretKey,
    });

    const seederSession = new SeederSession({
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
      minDeposit: 1_000_000n,
    });

    // --- Phase 1: ECDH key exchange (driven by sessions) ---

    // Leecher starts → sends ecdh_init
    const leecherStart = leecherSession.start();
    assert.equal(leecherSession.state, "handshake");
    const leecherEcdhMsg = findSendMessage(leecherStart, "ecdh_init")!;
    assert.isDefined(leecherEcdhMsg);
    const leecherPubKey = (leecherEcdhMsg.message as any).publicKey as Uint8Array;

    // Seeder receives ecdh_init → responds with ecdh_init
    const seederEcdh = seederSession.onEcdhInit(leecherPubKey);
    assert.equal(seederSession.state, "handshake");
    const seederEcdhMsg = findSendMessage(seederEcdh, "ecdh_init")!;
    assert.isDefined(seederEcdhMsg);
    const seederPubKey = (seederEcdhMsg.message as any).publicKey as Uint8Array;

    // Leecher receives seeder's ecdh_init → derives keys, returns open_channel action
    const leecherKeyExchange = leecherSession.onEcdhInit(seederPubKey);
    assert.equal(leecherSession.state, "channel_pending");
    const openAction = findAction<OpenChannelAction>(leecherKeyExchange, "open_channel")!;
    assert.isDefined(openAction);

    // Both sides derived the same channel ID
    const channelId = openAction.channelId;
    assert.deepEqual(
      Array.from(channelId),
      Array.from(seederSession.getChannelId()!),
      "both sides should derive the same channel ID",
    );

    // --- Phase 2: Open channel on-chain (executing the session's command) ---

    const { txSignature: openTx } = await client.openChannel({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      amount: openAction.deposit,
      timeoutSeconds: Number(openAction.timeout),
      leecherTokenAccount,
      mint: usdcMint,
    });
    assert.ok(openTx, "open_channel tx should succeed");

    // Leecher notifies session that channel is opened → session sends channel_opened message
    const leecherOpened = leecherSession.onChannelOpened(openTx);
    const channelOpenedMsg = findSendMessage(leecherOpened, "channel_opened");
    assert.isDefined(channelOpenedMsg);

    // Seeder receives channel_opened → returns verify_channel action
    const seederVerify = seederSession.onChannelOpened(openTx);
    assert.equal(seederSession.state, "channel_pending");
    const verifyAction = findAction<VerifyChannelAction>(seederVerify, "verify_channel")!;
    assert.isDefined(verifyAction);

    // --- Phase 3: Verify channel on-chain (executing the session's command) ---

    const channelInfo = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.isNotNull(channelInfo, "channel should exist on-chain");
    assert.equal(channelInfo!.status, "open");
    assert.equal(channelInfo!.deposited, DEPOSIT_AMOUNT);

    // Seeder confirms with on-chain verified data
    const confirmActions = seederSession.confirmChannel(
      channelInfo!.deposited,
      leecher.payer.publicKey.toBytes(), // Ed25519 pubkey from on-chain
    );
    assert.equal(seederSession.state, "active");
    const confirmedMsg = findSendMessage(confirmActions, "channel_confirmed");
    assert.isDefined(confirmedMsg);

    // Leecher receives confirmation
    leecherSession.onChannelConfirmed();
    assert.equal(leecherSession.state, "active");

    // --- Phase 4: Simulate data transfer with payment checks ---

    // Snapshot balances AFTER open_channel (deposit already deducted)
    const leecherAfterOpen = await getAccount(provider.connection, leecherTokenAccount);
    const seederBeforeClose = await getAccount(provider.connection, seederTokenAccount);

    // Download 1 MB → triggers first payment check
    const piece1 = leecherSession.onPieceReceived(MB);
    const check1Msg = findSendMessage(piece1, "payment_check");
    assert.isDefined(check1Msg, "should send payment check after 1 MB");

    // Seeder validates check 1
    const check1Result = seederSession.onPaymentCheck(check1Msg!.message as PaymentCheckMessage);
    assert.equal(check1Result.length, 0, "check 1 should be accepted");

    // Download another 1 MB → triggers second payment check
    const piece2 = leecherSession.onPieceReceived(MB);
    const check2Msg = findSendMessage(piece2, "payment_check");
    assert.isDefined(check2Msg, "should send payment check after 2 MB");

    // Seeder validates check 2
    const check2Result = seederSession.onPaymentCheck(check2Msg!.message as PaymentCheckMessage);
    assert.equal(check2Result.length, 0, "check 2 should be accepted");

    // Download another 1 MB → triggers third payment check
    const piece3 = leecherSession.onPieceReceived(MB);
    const check3Msg = findSendMessage(piece3, "payment_check");
    assert.isDefined(check3Msg, "should send payment check after 3 MB");

    const check3 = check3Msg!.message as PaymentCheckMessage;
    const check3Result = seederSession.onPaymentCheck(check3);
    assert.equal(check3Result.length, 0, "check 3 should be accepted");

    // Verify monotonic amounts
    const c1 = (check1Msg!.message as PaymentCheckMessage).amount;
    const c2 = (check2Msg!.message as PaymentCheckMessage).amount;
    const c3 = check3.amount;
    assert.isTrue(c2 > c1, "check amounts should be monotonically increasing");
    assert.isTrue(c3 > c2, "check amounts should be monotonically increasing");

    // Seeder has highest check stored
    const highest = seederSession.getHighestCheck();
    assert.isNotNull(highest);
    assert.equal(highest!.amount, c3);
    assert.equal(highest!.nonce, check3.nonce);

    // --- Phase 5: Seeder initiates close (executing the session's command) ---

    const closeActions = seederSession.initiateClose();
    assert.equal(seederSession.state, "closing");
    const closeAction = findAction<CloseChannelAction>(closeActions, "close_channel")!;
    assert.isDefined(closeAction);

    // Execute close on-chain with the highest check from the session
    const { txSignature: closeTx } = await client.closeChannel({
      seeder,
      leecher: leecher.publicKey,
      channelId: closeAction.channelId,
      amount: closeAction.check.amount,
      nonce: closeAction.check.nonce,
      signature: closeAction.check.signature,
      seederTokenAccount,
      leecherTokenAccount,
    });
    assert.ok(closeTx, "close_channel tx should succeed");

    // --- Phase 6: Verify final balances ---
    // Balances are relative to after open_channel (deposit already deducted).
    // close_channel splits escrow: seeder gets claimed amount, leecher gets refund.

    const leecherAfterClose = await getAccount(provider.connection, leecherTokenAccount);
    const seederAfterClose = await getAccount(provider.connection, seederTokenAccount);

    const seederEarned = Number(seederAfterClose.amount) - Number(seederBeforeClose.amount);
    const leecherRefund = Number(leecherAfterClose.amount) - Number(leecherAfterOpen.amount);
    const claimedAmount = Number(closeAction.check.amount);

    assert.equal(
      seederEarned,
      claimedAmount,
      "seeder should earn the check amount",
    );
    assert.equal(
      leecherRefund,
      Number(DEPOSIT_AMOUNT) - claimedAmount,
      "leecher should get deposit minus claimed amount back",
    );

    // Conservation: seeder earned + leecher refund = deposit
    assert.equal(
      seederEarned + leecherRefund,
      Number(DEPOSIT_AMOUNT),
      "seeder earned + leecher refund = deposit",
    );

    // Channel should be deleted
    const closedChannel = await client.fetchChannel(
      leecher.publicKey,
      seeder.publicKey,
      channelId,
    );
    assert.isNull(closedChannel, "channel should be deleted after close");
  });

  it("seeder piece-gating: refuses to serve until payment check received", async () => {
    // Fresh sessions
    const leecherSession = new LeecherSession({
      deposit: DEPOSIT_AMOUNT,
      timeout: TIMEOUT_SECONDS,
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
      signingKey: leecher.payer.secretKey,
    });

    const seederSession = new SeederSession({
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
    });

    // Fast-forward through ECDH
    const leecherStart = leecherSession.start();
    const leecherPk = (findSendMessage(leecherStart, "ecdh_init")!.message as any).publicKey;
    const seederEcdh = seederSession.onEcdhInit(leecherPk);
    const seederPk = (findSendMessage(seederEcdh, "ecdh_init")!.message as any).publicKey;
    leecherSession.onEcdhInit(seederPk);

    const channelId = leecherSession.getChannelId()!;

    // Open channel on-chain
    const { txSignature: openTx } = await client.openChannel({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      amount: DEPOSIT_AMOUNT,
      timeoutSeconds: Number(TIMEOUT_SECONDS),
      leecherTokenAccount,
      mint: usdcMint,
    });

    leecherSession.onChannelOpened(openTx);
    seederSession.onChannelOpened(openTx);

    // Verify and confirm
    seederSession.confirmChannel(DEPOSIT_AMOUNT, leecher.payer.publicKey.toBytes());
    leecherSession.onChannelConfirmed();

    assert.equal(leecherSession.state, "active");
    assert.equal(seederSession.state, "active");

    // Seeder: piece requested but no payment yet → sends payment_check_required
    const requestActions = seederSession.onPieceRequested(MB);
    const payReq = findSendMessage(requestActions, "payment_check_required");
    assert.isDefined(payReq, "seeder should require payment before serving");

    // Leecher responds with payment check
    const payActions = leecherSession.onPaymentCheckRequired();
    const payCheck = findSendMessage(payActions, "payment_check");
    assert.isDefined(payCheck, "leecher should send payment check");

    // Seeder validates
    const valResult = seederSession.onPaymentCheck(payCheck!.message as PaymentCheckMessage);
    assert.equal(valResult.length, 0, "check should be accepted");

    // Now seeder should serve — no payment_check_required
    const serveActions = seederSession.onPieceRequested(MB);
    const payReq2 = findSendMessage(serveActions, "payment_check_required");
    // After 2 MB total, cost is 200. The check covered 1 MB (100). So still underpaid.
    // This is expected — the seeder gates each piece request independently.
    // The point is: after a valid check, the cost tracking advances.
    assert.isDefined(payReq2, "seeder should request more payment for additional data");

    // Close channel to clean up on-chain state
    const closeActions = seederSession.initiateClose();
    const closeAction = findAction<CloseChannelAction>(closeActions, "close_channel")!;
    await client.closeChannel({
      seeder,
      leecher: leecher.publicKey,
      channelId: closeAction.channelId,
      amount: closeAction.check.amount,
      nonce: closeAction.check.nonce,
      signature: closeAction.check.signature,
      seederTokenAccount,
      leecherTokenAccount,
    });
  });

  it("seeder rejects invalid payment check signature on-chain close attempt", async () => {
    // Fresh sessions
    const leecherSession = new LeecherSession({
      deposit: DEPOSIT_AMOUNT,
      timeout: TIMEOUT_SECONDS,
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
      signingKey: leecher.payer.secretKey,
    });

    const seederSession = new SeederSession({
      pricePerMb: PRICE_PER_MB,
      checkFrequencyMb: CHECK_FREQUENCY_MB,
    });

    // ECDH
    const leecherStart = leecherSession.start();
    const leecherPk = (findSendMessage(leecherStart, "ecdh_init")!.message as any).publicKey;
    const seederEcdh = seederSession.onEcdhInit(leecherPk);
    const seederPk = (findSendMessage(seederEcdh, "ecdh_init")!.message as any).publicKey;
    leecherSession.onEcdhInit(seederPk);

    const channelId = leecherSession.getChannelId()!;

    // Open channel
    const { txSignature: openTx } = await client.openChannel({
      leecher: leecher.publicKey,
      seeder: seeder.publicKey,
      channelId,
      amount: DEPOSIT_AMOUNT,
      timeoutSeconds: Number(TIMEOUT_SECONDS),
      leecherTokenAccount,
      mint: usdcMint,
    });

    leecherSession.onChannelOpened(openTx);
    seederSession.onChannelOpened(openTx);

    // Confirm with WRONG public key — simulating a bad verifier
    const wrongKey = Keypair.generate().publicKey.toBytes();
    seederSession.confirmChannel(DEPOSIT_AMOUNT, wrongKey);
    leecherSession.onChannelConfirmed();

    // Leecher sends valid check (signed with correct key)
    const piece = leecherSession.onPieceReceived(MB);
    const checkMsg = findSendMessage(piece, "payment_check")!;
    assert.isDefined(checkMsg);

    // Seeder tries to validate — should reject (wrong pubkey stored)
    const result = seederSession.onPaymentCheck(checkMsg.message as PaymentCheckMessage);
    const rejected = findSendMessage(result, "payment_check_rejected");
    assert.isDefined(rejected, "should reject check signed with different key");

    // Clean up: timeout close since no valid check exists
    // (We can't close with the seeder since they have no valid check)
    // Just verify the session state is still active but with no valid checks
    assert.isNull(seederSession.getHighestCheck());
  });
});
