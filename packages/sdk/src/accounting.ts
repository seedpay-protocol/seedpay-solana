const BYTES_PER_MB = BigInt(1_048_576);

export const computeCost = (bytes: bigint, pricePerMb: bigint): bigint => {
  return (bytes * pricePerMb + BYTES_PER_MB - 1n) / BYTES_PER_MB;
};

export const shouldSendCheck = (
  bytesDownloaded: bigint,
  lastCheckAmount: bigint,
  pricePerMb: bigint,
  checkFrequencyMb: bigint,
): boolean => {
  const currentCost = computeCost(bytesDownloaded, pricePerMb);
  const threshold = lastCheckAmount + computeCost(checkFrequencyMb * BYTES_PER_MB, pricePerMb);
  return currentCost >= threshold;
};

export const isPaymentSufficient = (
  cumulativeCost: bigint,
  lastCheckAmount: bigint,
): boolean => {
  return lastCheckAmount >= cumulativeCost;
};

export class PieceAccounting {
  private pricePerMb: bigint;
  private checkFrequencyMb: bigint;
  private totalBytes = 0n;
  private lastCheckAmount = 0n;
  private lastNonce = 0n;

  constructor(pricePerMb: bigint, checkFrequencyMb: bigint) {
    this.pricePerMb = pricePerMb;
    this.checkFrequencyMb = checkFrequencyMb;
  }

  recordBytes(bytes: bigint): void {
    this.totalBytes += bytes;
  }

  recordCheck(amount: bigint, nonce: bigint): void {
    if (amount < this.lastCheckAmount) {
      throw new Error("Check amount must be monotonically increasing");
    }
    if (nonce <= this.lastNonce) {
      throw new Error("Nonce must be strictly increasing");
    }
    this.lastCheckAmount = amount;
    this.lastNonce = nonce;
  }

  needsCheck(): boolean {
    return shouldSendCheck(
      this.totalBytes,
      this.lastCheckAmount,
      this.pricePerMb,
      this.checkFrequencyMb,
    );
  }

  getNextCheckAmount(): bigint {
    return computeCost(this.totalBytes, this.pricePerMb);
  }

  getNextNonce(): bigint {
    return this.lastNonce + 1n;
  }

  getTotalBytes(): bigint {
    return this.totalBytes;
  }

  getLastCheckAmount(): bigint {
    return this.lastCheckAmount;
  }

  getLastNonce(): bigint {
    return this.lastNonce;
  }
}
