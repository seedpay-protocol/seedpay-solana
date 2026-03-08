import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

export function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.startsWith("~")
    ? filePath.replace("~", process.env.HOME || "")
    : filePath;

  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const bytes = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(bytes);
}
