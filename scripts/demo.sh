#!/usr/bin/env bash
#
# scripts/demo.sh
#
# One-command devnet demo for SeedPay.
#
# This script:
#   1. Checks that .env.devnet exists (run setup-devnet.sh first if not)
#   2. Checks leecher has enough USDC (offers to mint more)
#   3. Runs the full demo: ECDH → open → transfer → close
#   4. Prints Solana Explorer links
#
# Usage:
#   chmod +x scripts/demo.sh
#   ./scripts/demo.sh
#
# Or via pnpm:
#   pnpm demo:devnet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.devnet"

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo "    SeedPay — Devnet Demo"
echo "  ═══════════════════════════════════════════════════════"
echo ""

# ── Pre-flight checks ────────────────────────────────────

# Check .env.devnet exists
if [ ! -f "$ENV_FILE" ]; then
  echo "  ✗ .env.devnet not found."
  echo "    Run: ./scripts/setup-devnet.sh"
  echo ""
  exit 1
fi

echo "  ✓ .env.devnet found"

# Source env vars
set -a
source "$ENV_FILE"
set +a

# Check program exists on devnet
echo "  ✓ Program ID: $PROGRAM_ID"

# Check leecher SOL
LEECHER_SOL=$(solana balance "$LEECHER_PUBKEY" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo "0")
echo "  ✓ Leecher SOL: $LEECHER_SOL"

if (( $(echo "$LEECHER_SOL < 0.01" | bc -l 2>/dev/null || echo 1) )); then
  echo ""
  echo "  ⚠ Leecher needs more SOL. Requesting airdrop..."
  solana airdrop 1 "$LEECHER_PUBKEY" --url "$RPC_URL" >/dev/null 2>&1 || true
  sleep 2
fi

# Check seeder SOL
SEEDER_SOL=$(solana balance "$SEEDER_PUBKEY" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo "0")
echo "  ✓ Seeder SOL:  $SEEDER_SOL"

if (( $(echo "$SEEDER_SOL < 0.01" | bc -l 2>/dev/null || echo 1) )); then
  echo ""
  echo "  ⚠ Seeder needs more SOL. Requesting airdrop..."
  solana airdrop 1 "$SEEDER_PUBKEY" --url "$RPC_URL" >/dev/null 2>&1 || true
  sleep 2
fi

# Check leecher USDC balance
LEECHER_USDC=$(spl-token balance --address "$LEECHER_TOKEN_ACCOUNT" --url "$RPC_URL" 2>/dev/null || echo "0")
echo "  ✓ Leecher USDC: $LEECHER_USDC"

# If balance is low, mint more
USDC_FLOAT=$(echo "$LEECHER_USDC" | tr -d ' ')
if (( $(echo "$USDC_FLOAT < 0.05" | bc -l 2>/dev/null || echo 1) )); then
  echo ""
  echo "  ⚠ Leecher USDC is low. Minting 1.0 Test USDC..."
  spl-token mint "$MINT_PUBKEY" 1 \
    --recipient "$LEECHER_TOKEN_ACCOUNT" \
    --mint-authority "$MINT_AUTHORITY_KEYPAIR" \
    --url "$RPC_URL" \
    >/dev/null 2>&1 || echo "  ⚠ Mint failed — you may need to run setup-devnet.sh again"
  LEECHER_USDC=$(spl-token balance --address "$LEECHER_TOKEN_ACCOUNT" --url "$RPC_URL" 2>/dev/null || echo "?")
  echo "  ✓ Leecher USDC: $LEECHER_USDC"
fi

echo ""
echo "  ── Running Demo ────────────────────────────────────"
echo ""

# ── Run the devnet demo ──────────────────────────────────

cd "$PROJECT_DIR"

# Use tsx to run TypeScript directly
npx tsx packages/demo/src/run-devnet.ts

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo "    Demo complete! Check the Explorer links above."
echo "  ═══════════════════════════════════════════════════════"
echo ""