export interface DemoConfig {
  fileName: string;
  fileSize: number;
  pieceSize: number;
  pricePerMbBaseUnits: number;
  checkFrequency: number;
  timeoutSeconds: number;
  depositAmount: bigint;
  pieceDelayMs: number;
  tokenDecimals: number;
}

export const totalPieces = (config: DemoConfig): number => {
  return Math.ceil(config.fileSize / config.pieceSize);
};

export const totalCostBaseUnits = (config: DemoConfig): bigint => {
  const totalMb = config.fileSize / (1024 * 1024);
  return BigInt(Math.ceil(totalMb * config.pricePerMbBaseUnits));
};

export const formatUsdc = (
  baseUnits: bigint | number,
  decimals = 6,
): string => {
  const n = Number(baseUnits);
  return (n / 10 ** decimals).toFixed(decimals > 4 ? 4 : decimals);
};

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

export const defaultConfig = (): DemoConfig => {
  const fileSize = 10 * 1024 * 1024 * 1024;
  const pieceSize = 256 * 1024;
  const pricePerMBBaseUnits = 100;
  const totalMb = fileSize / (1024 * 1024);
  const totalCost = Math.ceil(totalMb * pricePerMBBaseUnits);
  const deposit = BigInt(Math.max(Math.ceil(totalCost * 1.2), 10_000)); // total cost + 20% buffer, min. 0.01 USDC

  return {
    fileName: "llama-3.1-8b-instruct.Q4_K_M.gguf",
    fileSize,
    pieceSize,
    pricePerMbBaseUnits: pricePerMBBaseUnits,
    checkFrequency: 100,
    timeoutSeconds: 3600,
    depositAmount: deposit,
    pieceDelayMs: 2,
    tokenDecimals: 6,
  };
};
