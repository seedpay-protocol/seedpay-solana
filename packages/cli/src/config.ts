import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "7DwPMoGzTjRUroE47VPEEJn4FBSypAA5dbeMn3ocVdsS",
);

export const DEFAULTS = {
  rpcUrl: "https://api.devnet.solana.com",
  pricePerMb: 100n, // base units per MB
  deposit: 1_000_000n, // 1 USDC (6 decimals)
  timeoutSeconds: 3600,
  checkFrequencyMb: 1n, // send check every 1 MB
  tokenDecimals: 6,
};

export interface CliConfig {
  rpcUrl: string;
  programId: PublicKey;
  mint: PublicKey;
  pricePerMb: bigint;
  deposit: bigint;
  timeoutSeconds: number;
  checkFrequencyMb: bigint;
}

export function resolveConfig(opts: {
  rpc?: string;
  mint?: string;
  price?: string;
  deposit?: string;
  timeout?: string;
}): CliConfig {
  return {
    rpcUrl: opts.rpc || process.env.SEEDPAY_RPC_URL || DEFAULTS.rpcUrl,
    programId: PROGRAM_ID,
    mint: new PublicKey(opts.mint || process.env.SEEDPAY_MINT || PublicKey.default.toBase58()),
    pricePerMb: opts.price ? BigInt(opts.price) : DEFAULTS.pricePerMb,
    deposit: opts.deposit ? BigInt(opts.deposit) : DEFAULTS.deposit,
    timeoutSeconds: opts.timeout ? parseInt(opts.timeout, 10) : DEFAULTS.timeoutSeconds,
    checkFrequencyMb: DEFAULTS.checkFrequencyMb,
  };
}

export function formatTokens(baseUnits: bigint | number, decimals = 6): string {
  const n = Number(baseUnits);
  return (n / 10 ** decimals).toFixed(decimals > 4 ? 4 : decimals);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
