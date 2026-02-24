import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import type { Seedpay } from "../../../target/types/seedpay";
import { Leecher } from "./leecher";
import { Seeder } from "./seeder";
import { simulateTransfer } from "./simulate";
import { defaultConfig, formatUsdc, formatBytes } from "./config";

const EXPLORER = "https://explorer.solana.com";
const CLUSTER = "devnet";

function log(phase: string, msg: string) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`  [${timestamp}] ${phase.padEnd(12)} ${msg}`);
}

function explorerTx(sig: string): string {
  return `${EXPLORER}/tx/${sig}?cluster=${CLUSTER}`;
}

function explorerAddr(addr: string): string {
  return `${EXPLORER}/address/${addr}?cluster=${CLUSTER}`;
}

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.startsWith("~")
    ? filePath.replace("~", process.env.HOME || "")
    : filePath;
  const raw = fs.readFileSync(resolved, "utf-8");
  const bytes = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(bytes);
}

interface DevnetEnv {
  rpcUrl: string;
  programId: string;
  leecherKeypairPath: string;
  seederKeypairPath: string;
  mintAuthorityKeypairPath: string;
  leecherPubkey: string;
  seederPubkey: string;
  mintPubkey: string;
}

function loadEnv(): DevnetEnv {
  const envPath = path.resolve(__dirname, "..", "..", "..", ".env.devnet");

  if (!fs.existsSync(envPath)) {
    console.error(`\n  ✗ .env.devnet not found at ${envPath}`);
    console.error("    Run scripts/setup-devnet.sh first.\n");
    process.exit(1);
  }

  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }

  return {
    rpcUrl: env.RPC_URL || clusterApiUrl("devnet"),
    programId: env.PROGRAM_ID || "",
    leecherKeypairPath: env.LEECHER_KEYPAIR || "",
    seederKeypairPath: env.SEEDER_KEYPAIR || "",
    mintAuthorityKeypairPath: env.MINT_AUTHORITY_KEYPAIR || "",
    leecherPubkey: env.LEECHER_PUBKEY || "",
    seederPubkey: env.SEEDER_PUBKEY || "",
    mintPubkey: env.MINT_PUBKEY || "",
  };
}

async function main() {
  console.log("");
  console.log("  " + "\u2550".repeat(57));
  console.log("    SeedPay Demo — Devnet");
  console.log("  " + "\u2550".repeat(57));
  console.log("");

  log("SETUP", "Loading .env.devnet...");
  const env = loadEnv();

  const connection = new Connection(env.rpcUrl, "confirmed");
  log("SETUP", `RPC: ${env.rpcUrl}`);
  log("SETUP", `Program: ${env.programId}`);

  const leecherWallet = loadKeypair(env.leecherKeypairPath);
  const seederWallet = loadKeypair(env.seederKeypairPath);
  const mintAuthority = loadKeypair(env.mintAuthorityKeypairPath);
  const mint = new PublicKey(env.mintPubkey);

  log(
    "SETUP",
    `Leecher: ${leecherWallet.publicKey.toBase58().slice(0, 12)}...`,
  );
  log("SETUP", `Seeder:  ${seederWallet.publicKey.toBase58().slice(0, 12)}...`);

  const leecherSol = await connection.getBalance(leecherWallet.publicKey);
  const seederSol = await connection.getBalance(seederWallet.publicKey);
  log("SETUP", `Leecher SOL: ${(leecherSol / 1e9).toFixed(4)}`);
  log("SETUP", `Seeder SOL:  ${(seederSol / 1e9).toFixed(4)}`);

  if (leecherSol < 0.01 * 1e9) {
    console.error(
      "\n  ✗ Leecher has insufficient SOL. Run setup-devnet.sh or airdrop manually.\n",
    );
    process.exit(1);
  }

  log("SETUP", "Ensuring token accounts exist...");
  const leecherAta = await getOrCreateAssociatedTokenAccount(
    connection,
    leecherWallet,
    mint,
    leecherWallet.publicKey,
  );
  const seederAta = await getOrCreateAssociatedTokenAccount(
    connection,
    seederWallet,
    mint,
    seederWallet.publicKey,
  );
  const leecherTokenAccount = leecherAta.address;
  const seederTokenAccount = seederAta.address;
  log(
    "SETUP",
    `Leecher ATA: ${leecherTokenAccount.toBase58().slice(0, 16)}...`,
  );
  log("SETUP", `Seeder ATA:  ${seederTokenAccount.toBase58().slice(0, 16)}...`);

  const config = defaultConfig();
  log("SETUP", `File: ${config.fileName} (${formatBytes(config.fileSize)})`);
  log("SETUP", `Price: ${formatUsdc(config.pricePerMbBaseUnits)} USDC/MB`);
  log("SETUP", `Deposit: ${formatUsdc(config.depositAmount)} USDC`);

  const leecherUsdcBalance = BigInt(leecherAta.amount.toString());
  log("SETUP", `Leecher USDC: ${Number(leecherUsdcBalance) / 1e6}`);

  if (leecherUsdcBalance < config.depositAmount) {
    const mintAmount = config.depositAmount - leecherUsdcBalance;
    log("SETUP", `Minting ${formatUsdc(mintAmount)} test USDC to leecher...`);
    await mintTo(
      connection,
      leecherWallet,
      mint,
      leecherTokenAccount,
      mintAuthority,
      Number(mintAmount),
    );
    log("SETUP", "Mint complete \u2713");
  }

  log("SETUP", "Setup complete \u2713");
  console.log("");

  const leecherProvider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(leecherWallet),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const seederProvider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(seederWallet),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );

  const idlPath = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "target",
    "idl",
    "seedpay.json",
  );
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

  const leecherProgram = new Program<Seedpay>(idl, leecherProvider);
  const seederProgram = new Program<Seedpay>(idl, seederProvider);

  const leecherRole = new Leecher(
    leecherProgram,
    leecherWallet,
    leecherTokenAccount,
    mint,
    config,
  );
  const seederRole = new Seeder(
    seederProgram,
    seederWallet,
    seederTokenAccount,
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

  log("CHANNEL", "Opening payment channel on devnet...");
  const openResult = await leecherRole.openChannel(seederWallet.publicKey);
  log("CHANNEL", `TX: ${openResult.txSignature.slice(0, 24)}...`);
  log("CHANNEL", `\u2192 ${explorerTx(openResult.txSignature)}`);
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
  log(
    "VERIFY",
    `Channel PDA: ${channelInfo.pdas.channelState.toBase58().slice(0, 16)}...`,
  );
  log(
    "VERIFY",
    `\u2192 ${explorerAddr(channelInfo.pdas.channelState.toBase58())}`,
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

  const closeResult = await seederRole.closeChannel(leecherTokenAccount);
  log("CLOSE", `TX: ${closeResult.txSignature.slice(0, 24)}...`);
  log("CLOSE", `\u2192 ${explorerTx(closeResult.txSignature)}`);
  console.log("");

  const leecherFinal = await connection.getTokenAccountBalance(
    leecherTokenAccount,
  );
  const seederFinal = await connection.getTokenAccountBalance(
    seederTokenAccount,
  );

  console.log("  " + "\u2550".repeat(57));
  console.log("    Final Summary — Devnet");
  console.log("  " + "\u2550".repeat(57));
  console.log("");
  console.log(
    `    Seeder earned:         ${formatUsdc(highestCheck.amount)} USDC`,
  );
  console.log(
    `    Leecher refunded:      ${formatUsdc(
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
  console.log(`    On-chain transactions: 2`);
  console.log(`    Off-chain checks:      ${result.totalChecks}`);
  console.log(`    Data transferred:      ${formatBytes(result.totalBytes)}`);
  console.log("");
  console.log("    Explorer Links:");
  console.log(`    Open TX:   ${explorerTx(openResult.txSignature)}`);
  console.log(`    Close TX:  ${explorerTx(closeResult.txSignature)}`);
  console.log(`    Program:   ${explorerAddr(env.programId)}`);
  console.log(
    `    Leecher:   ${explorerAddr(leecherWallet.publicKey.toBase58())}`,
  );
  console.log(
    `    Seeder:    ${explorerAddr(seederWallet.publicKey.toBase58())}`,
  );
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
  if (err.logs) {
    console.error("\n  Program logs:");
    err.logs.forEach((l: string) => console.error(`    ${l}`));
  }
  console.error(err);
  process.exit(1);
});
