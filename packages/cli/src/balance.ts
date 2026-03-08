import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { loadKeypair } from "./wallet";
import { resolveConfig, formatTokens } from "./config";
import { log, banner } from "./logger";

interface BalanceOpts {
  wallet: string;
  mint?: string;
  rpc?: string;
}

export async function balanceAction(opts: BalanceOpts): Promise<void> {
  banner("SeedPay — Balance");

  const config = resolveConfig(opts);
  const wallet = loadKeypair(opts.wallet);
  const connection = new Connection(config.rpcUrl, "confirmed");

  const pubkey = wallet.publicKey;
  log("WALLET", `Address: ${pubkey.toBase58()}`);

  // SOL balance
  const solBalance = await connection.getBalance(pubkey);
  log("BALANCE", `SOL: ${(solBalance / 1e9).toFixed(4)}`);

  // Token balance
  if (config.mint.equals(PublicKey.default)) {
    log("BALANCE", "No --mint specified, skipping token balance");
    return;
  }

  try {
    const ata = await getAssociatedTokenAddress(config.mint, pubkey);
    const account = await getAccount(connection, ata);
    const balance = BigInt(account.amount.toString());
    log("BALANCE", `Token: ${formatTokens(balance)} (${config.mint.toBase58().slice(0, 16)}...)`);
    log("BALANCE", `ATA: ${ata.toBase58()}`);
  } catch {
    log("BALANCE", "No token account found for this mint");
  }

  console.log("");
}
