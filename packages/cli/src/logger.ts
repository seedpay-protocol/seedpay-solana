export function log(phase: string, msg: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`  [${timestamp}] ${phase.padEnd(12)} ${msg}`);
}

export function logError(phase: string, msg: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`  [${timestamp}] ${phase.padEnd(12)} ${msg}`);
}

export function banner(title: string): void {
  console.log("");
  console.log("  " + "\u2550".repeat(50));
  console.log(`    ${title}`);
  console.log("  " + "\u2550".repeat(50));
  console.log("");
}
