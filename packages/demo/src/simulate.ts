import type { PaymentCheck } from "../../sdk/src";
import type { Leecher } from "./leecher";
import type { Seeder } from "./seeder";
import { DemoConfig, totalPieces, formatUsdc, formatBytes } from "./config";

export interface TransferProgress {
  currentPiece: number;
  totalPieces: number;
  bytesTransferred: number;
  totalBytes: number;
  checks: Array<{ nonce: number; amount: bigint; bytesAtSign: number }>;
  channelDeposit: bigint;
  pricePerMb: number;
  sessionHashHex: string;
}

function renderProgress(
  config: DemoConfig,
  progress: TransferProgress,
): string {
  const pct = Math.min(
    100,
    Math.floor((progress.bytesTransferred / progress.totalBytes) * 100),
  );
  const barWidth = 40;
  const filled = Math.floor((pct / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = "\u2501".repeat(filled) + "\u2591".repeat(empty);

  const lines: string[] = [];
  lines.push("");
  lines.push("\u2550".repeat(59));
  lines.push("  SeedPay Demo \u2014 Paid File Transfer on Solana");
  lines.push("\u2550".repeat(59));
  lines.push("");
  lines.push(`  File: ${config.fileName} (${formatBytes(config.fileSize)})`);
  lines.push(
    `  Price: ${formatUsdc(
      config.pricePerMbBaseUnits,
      6,
    )} USDC/MB | Channel deposit: ${formatUsdc(
      progress.channelDeposit,
      6,
    )} USDC`,
  );
  lines.push("");
  lines.push(
    `  ECDH Session: 0x${progress.sessionHashHex.slice(
      0,
      8,
    )}...${progress.sessionHashHex.slice(-4)} (private \u2014 not on chain)`,
  );
  lines.push("");
  lines.push(`  ${bar}  ${pct}%`);
  lines.push(
    `  ${formatBytes(
      progress.bytesTransferred,
    )} transferred | ${progress.currentPiece.toLocaleString()} / ${progress.totalPieces.toLocaleString()} pieces`,
  );
  lines.push("");
  lines.push("  Payment Checks:");

  for (const c of progress.checks) {
    lines.push(
      `  \u2713 Check #${c.nonce}  \u2014 ${formatUsdc(
        c.amount,
      )} USDC (nonce: ${c.nonce})   \u2190 ${formatBytes(c.bytesAtSign)}`,
    );
  }

  // Show pending indicator if transfer not complete
  if (progress.bytesTransferred < progress.totalBytes) {
    lines.push(
      `  \u23F3 Check #${progress.checks.length + 1} \u2014 pending...`,
    );
  }

  lines.push("");

  const earned =
    progress.checks.length > 0
      ? progress.checks[progress.checks.length - 1].amount
      : 0n;
  const remaining = progress.channelDeposit - BigInt(earned);

  lines.push(`  Seeder earned so far: ${formatUsdc(earned)} USDC`);
  lines.push(`  Channel balance remaining: ${formatUsdc(remaining)} USDC`);
  lines.push("");
  lines.push("\u2550".repeat(59));

  return lines.join("\n");
}

export interface SimulateResult {
  totalPieces: number;
  totalBytes: number;
  totalChecks: number;
  finalAmount: bigint;
  elapsedMs: number;
}

export async function simulateTransfer(
  leecher: Leecher,
  seeder: Seeder,
  config: DemoConfig,
): Promise<SimulateResult> {
  const pieces = totalPieces(config);
  const sessionHashHex = Buffer.from(
    leecher.state.sessionKeys!.sessionUUID,
  ).toString("hex");

  const progress: TransferProgress = {
    currentPiece: 0,
    totalPieces: pieces,
    bytesTransferred: 0,
    totalBytes: config.fileSize,
    checks: [],
    channelDeposit: config.depositAmount,
    pricePerMb: config.pricePerMbBaseUnits,
    sessionHashHex,
  };

  const startTime = Date.now();

  process.stdout.write(renderProgress(config, progress));

  for (let i = 1; i <= pieces; i++) {
    const pieceBytes = Math.min(
      config.pieceSize,
      config.fileSize - progress.bytesTransferred,
    );
    progress.bytesTransferred += pieceBytes;
    progress.currentPiece = i;

    seeder.recordBytesServed(pieceBytes);

    if (i % config.checkFrequency === 0 || i === pieces) {
      const check: PaymentCheck = leecher.signCheck(progress.bytesTransferred);

      seeder.validateCheck(check, leecher.state.wallet.publicKey);

      progress.checks.push({
        nonce: Number(check.nonce),
        amount: check.amount,
        bytesAtSign: progress.bytesTransferred,
      });
    }

    if (config.pieceDelayMs > 0 && (i % 50 === 0 || i === pieces)) {
      const output = renderProgress(config, progress);
      const lineCount = output.split("\n").length;
      process.stdout.write(`\x1B[${lineCount}A\x1B[0J`);
      process.stdout.write(output);
      await sleep(config.pieceDelayMs);
    }
  }

  const output = renderProgress(config, progress);
  const lineCount = output.split("\n").length;
  process.stdout.write(`\x1B[${lineCount}A\x1B[0J`);
  process.stdout.write(output);

  const highestCheck = leecher.getHighestCheck();

  return {
    totalPieces: pieces,
    totalBytes: progress.bytesTransferred,
    totalChecks: progress.checks.length,
    finalAmount: highestCheck?.amount ?? 0n,
    elapsedMs: Date.now() - startTime,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
