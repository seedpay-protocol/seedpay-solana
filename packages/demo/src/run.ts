import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
  MINT_SIZE,
  ACCOUNT_SIZE,
} from "@solana/spl-token";
import type { Seedpay } from "../../../target/types/seedpay";
import { Leecher } from "./leecher";
import { Seeder } from "./seeder";
import { simulateTransfer } from "./simulate";
import { defaultConfig, formatUsdc, formatBytes } from "./config";

function log(phase: string, msg: string) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`  [${timestamp}] ${phase.padEnd(12)} ${msg}`);
}

async function main() {
  console.log("");
  console.log("  \u2550".repeat(29));
  console.log("    SeedPay Demo — Starting...");
  console.log("  \u2550".repeat(29));
  console.log("");

  log("SETUP", "Connecting to localnet...");
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Seedpay as Program<Seedpay>;
  log("SETUP", `Program ID: ${program.programId.toBase58()}`);

  const config = defaultConfig();
  log("SETUP", `File: ${config.fileName} (${formatBytes(config.fileSize)})`);
  log("SETUP", `Price: ${formatUsdc(config.pricePerMbBaseUnits)} USDC/MB`);
  log("SETUP", `Deposit: ${formatUsdc(config.depositAmount)} USDC`);

  const leecherWallet = Keypair.generate();
  const seederWallet = Keypair.generate();

  log("SETUP", "Airdropping SOL...");
  const airdropLeecher = await provider.connection.requestAirdrop(
    leecherWallet.publicKey,
    5 * anchor.web3.LAMPORTS_PER_SOL,
  );
  await provider.connection.confirmTransaction(airdropLeecher);
  const airdropSeeder = await provider.connection.requestAirdrop(
    seederWallet.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL,
  );
  await provider.connection.confirmTransaction(airdropSeeder);

  log(
    "SETUP",
    `Leecher: ${leecherWallet.publicKey.toBase58().slice(0, 12)}...`,
  );
  log("SETUP", `Seeder:  ${seederWallet.publicKey.toBase58().slice(0, 12)}...`);

  log("SETUP", "Creating mock USDC mint...");
  const mintAuthority = Keypair.generate();
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  const mintRent = await getMinimumBalanceForRentExemptMint(
    provider.connection,
  );
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint, 6, mintAuthority.publicKey, null),
  );
  await provider.sendAndConfirm(createMintTx, [mintKeypair]);

  log("SETUP", "Creating token accounts...");
  const leecherTokenAccount = Keypair.generate();
  const seederTokenAccount = Keypair.generate();
  const tokenAccountRent = await getMinimumBalanceForRentExemptAccount(
    provider.connection,
  );

  const createTokenAccounts = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: leecherTokenAccount.publicKey,
      space: ACCOUNT_SIZE,
      lamports: tokenAccountRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      leecherTokenAccount.publicKey,
      mint,
      leecherWallet.publicKey,
    ),
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: seederTokenAccount.publicKey,
      space: ACCOUNT_SIZE,
      lamports: tokenAccountRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      seederTokenAccount.publicKey,
      mint,
      seederWallet.publicKey,
    ),
  );
  await provider.sendAndConfirm(createTokenAccounts, [
    leecherTokenAccount,
    seederTokenAccount,
  ]);

  const mintAmount = Number(config.depositAmount) * 2; // 2x deposit for safety
  log("SETUP", `Minting ${formatUsdc(BigInt(mintAmount))} USDC to leecher...`);
  const mintTx = new Transaction().add(
    createMintToInstruction(
      mint,
      leecherTokenAccount.publicKey,
      mintAuthority.publicKey,
      mintAmount,
    ),
  );
  await provider.sendAndConfirm(mintTx, [mintAuthority]);

  log("SETUP", "Setup complete \u2713");
  console.log("");

  const leecherProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(leecherWallet),
    { commitment: "confirmed", preflightCommitment: "processed" },
  );
  const leecherProgram = new Program<Seedpay>(program.idl, leecherProvider);

  const seederProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(seederWallet),
    { commitment: "confirmed", preflightCommitment: "processed" },
  );
  const seederProgram = new Program<Seedpay>(program.idl, seederProvider);

  const leecherRole = new Leecher(
    leecherProgram,
    leecherWallet,
    leecherTokenAccount.publicKey,
    mint,
    config,
  );
  const seederRole = new Seeder(
    seederProgram,
    seederWallet,
    seederTokenAccount.publicKey,
    config,
  );

  log("ECDH", "Generating ephemeral keypairs...");
  const leecherEpk = leecherRole.getEphemeralPublicKey();
  const seederEpk = seederRole.getEphemeralPublicKey();

  log("ECDH", "Exchanging public keys...");
  const leecherSession = leecherRole.completeKeyExchange(seederEpk);
  const seederSession = seederRole.completeKeyExchange(leecherEpk);

  const leecherChId = Buffer.from(leecherSession.channelId).toString("hex");
  const seederChId = Buffer.from(seederSession.channelId).toString("hex");
  if (leecherChId !== seederChId) {
    throw new Error("ECDH mismatch — channel IDs differ!");
  }
  log("ECDH", `Channel ID: ${leecherChId.slice(0, 16)}... \u2713`);
  log(
    "ECDH",
    `Session hash: 0x${Buffer.from(leecherSession.sessionUUID)
      .toString("hex")
      .slice(0, 12)}... (on-chain memo)`,
  );
  console.log("");

  log("CHANNEL", "Opening payment channel on-chain...");
  const openResult = await leecherRole.openChannel(seederWallet.publicKey);
  log("CHANNEL", `TX: ${openResult.txSignature.slice(0, 20)}...`);
  log("CHANNEL", `Deposited: ${formatUsdc(config.depositAmount)} USDC`);
  log("CHANNEL", `Timeout: ${config.timeoutSeconds}s`);
  console.log("");

  log("VERIFY", "Seeder verifying channel on-chain...");
  const channelInfo = await seederRole.verifyChannel(leecherWallet.publicKey);
  log("VERIFY", `Status: ${channelInfo.status} \u2713`);
  log(
    "VERIFY",
    `Deposit confirmed: ${formatUsdc(channelInfo.deposited)} USDC \u2713`,
  );
  console.log("");

  log("TRANSFER", "Starting simulated download...");
  console.log("");

  const result = await simulateTransfer(leecherRole, seederRole, config);

  console.log("");
  log(
    "TRANSFER",
    `Complete! ${result.totalPieces} pieces, ${result.totalChecks} checks, ${result.elapsedMs}ms`,
  );
  console.log("");

  log("CLOSE", "Seeder closing channel with highest payment check...");
  const highestCheck = leecherRole.getHighestCheck()!;
  log(
    "CLOSE",
    `Claiming check #${highestCheck.nonce}: ${formatUsdc(
      highestCheck.amount,
    )} USDC`,
  );

  const closeResult = await seederRole.closeChannel(
    leecherTokenAccount.publicKey,
  );
  log("CLOSE", `TX: ${closeResult.txSignature.slice(0, 20)}...`);
  console.log("");

  const leecherFinal = await provider.connection.getTokenAccountBalance(
    leecherTokenAccount.publicKey,
  );
  const seederFinal = await provider.connection.getTokenAccountBalance(
    seederTokenAccount.publicKey,
  );

  console.log("  " + "\u2550".repeat(57));
  console.log("    Final Summary");
  console.log("  " + "\u2550".repeat(57));
  console.log("");
  console.log(
    `    Seeder earned:        ${formatUsdc(highestCheck.amount)} USDC`,
  );
  console.log(
    `    Leecher refunded:     ${formatUsdc(
      config.depositAmount - highestCheck.amount,
    )} USDC`,
  );
  console.log(
    `    Leecher final balance: ${leecherFinal.value.uiAmountString} USDC`,
  );
  console.log(
    `    Seeder final balance:  ${seederFinal.value.uiAmountString} USDC`,
  );
  console.log("");
  console.log(`    On-chain transactions: 2 (open + close)`);
  console.log(`    Off-chain checks:      ${result.totalChecks}`);
  console.log(`    Data transferred:      ${formatBytes(result.totalBytes)}`);
  console.log("");
  console.log("  " + "\u2550".repeat(57));
  console.log("");

  leecherRole.destroyEphemeralKeys();
  seederRole.destroyEphemeralKeys();

  log(
    "DONE",
    "Demo complete. Ephemeral keys destroyed (forward secrecy). \u2713",
  );
  console.log("");
}

main().catch((err) => {
  console.error("\n  \u274C Demo failed:", err.message || err);
  console.error(err);
  process.exit(1);
});
