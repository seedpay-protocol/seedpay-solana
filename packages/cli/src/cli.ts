import { Command } from "commander";
import { seedAction } from "./seed";
import { downloadAction } from "./download";
import { balanceAction } from "./balance";

export const program = new Command()
  .name("seedpay")
  .description("SeedPay — Paid BitTorrent seeding on Solana")
  .version("1.0.0");

program
  .command("seed <file>")
  .description("Seed a file and accept SeedPay payments")
  .requiredOption("--wallet <path>", "Path to Solana keypair JSON file")
  .option("--price <amount>", "Price per MB in token base units", "100")
  .option("--mint <address>", "SPL token mint address")
  .option("--rpc <url>", "Solana RPC URL")
  .option("--port <port>", "BitTorrent listen port", "6881")
  .action(seedAction);

program
  .command("download <torrent>")
  .description("Download a torrent and pay seeders via SeedPay")
  .requiredOption("--wallet <path>", "Path to Solana keypair JSON file")
  .option("--deposit <amount>", "Deposit amount in token base units")
  .option("--max-price <amount>", "Maximum acceptable price per MB")
  .option("--mint <address>", "SPL token mint address")
  .option("--rpc <url>", "Solana RPC URL")
  .option("--output <dir>", "Output directory", ".")
  .action(downloadAction);

program
  .command("balance")
  .description("Check wallet SOL and token balances")
  .requiredOption("--wallet <path>", "Path to Solana keypair JSON file")
  .option("--mint <address>", "SPL token mint address")
  .option("--rpc <url>", "Solana RPC URL")
  .action(balanceAction);
