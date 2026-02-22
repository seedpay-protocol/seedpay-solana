import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { before, describe, it } from "mocha";
import { Ed25519Program, Keypair, PublicKey } from "@solana/web3.js";
import { Seedpay } from "../target/types/seedpay";
import * as crypto from "crypto";
import { createAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

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
