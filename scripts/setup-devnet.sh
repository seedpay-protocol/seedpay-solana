#!/usr/bin/env bash
#
# scripts/setup-devnet.sh
#
# One-time devnet setup:
#   1. Deploy the SeedPay program to devnet
#   2. Create a "SeedPay Test USDC" mint (6 decimals)
#   3. Generate leecher + seeder keypairs
#   4. Airdrop devnet SOL to both
#   5. Create token accounts + mint test USDC to leecher
#   6. Save all addresses to .env.devnet for the demo script
#
# Prerequisites:
#   - solana CLI configured for devnet: solana config set --url devnet
#   - Anchor CLI installed
#   - spl-token CLI installed (comes with solana-cli)
#   - Funded deployer wallet (~3 SOL): solana airdrop 2
#
# Usage:
#   chmod +x scripts/setup-devnet.sh
#   ./scripts/setup-devnet.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$PROJECT_DIR/.devnet-keys"
ENV_FILE="$PROJECT_DIR/.env.devnet"

EXPLORER="https://explorer.solana.com"
CLUSTER="devnet"
RPC_URL="https://api.devnet.solana.com"

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo "    SeedPay — Devnet Setup"
echo "  ═══════════════════════════════════════════════════════"
echo ""

# ── Verify CLI tools ─────────────────────────────────────

for cmd in solana anchor spl-token; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  ✗ '$cmd' not found. Please install it first."
    exit 1
  fi
done
echo "  ✓ CLI tools found (solana, anchor, spl-token)"

# ── Verify solana config ─────────────────────────────────

CURRENT_URL=$(solana config get | grep "RPC URL" | awk '{print $NF}')
if [[ "$CURRENT_URL" != *"devnet"* ]]; then
  echo "  ⚠ Solana CLI not pointing to devnet. Setting now..."
  solana config set --url "$RPC_URL" >/dev/null
fi
echo "  ✓ Solana CLI configured for devnet"

DEPLOYER=$(solana address)
DEPLOYER_SOL=$(solana balance "$DEPLOYER" | awk '{print $1}')
echo "  ✓ Deployer: $DEPLOYER ($DEPLOYER_SOL SOL)"

if (( $(echo "$DEPLOYER_SOL < 1.0" | bc -l 2>/dev/null || echo 1) )); then
  echo "  ⚠ Low SOL balance. Requesting airdrop..."
  solana airdrop 2 "$DEPLOYER" || echo "  ⚠ Airdrop may have failed (rate limit). Ensure you have >= 2 SOL."
  sleep 2
fi

# ── Step 1: Deploy program ───────────────────────────────

echo ""
echo "  ── Step 1: Deploy Program ──────────────────────────"

cd "$PROJECT_DIR"

# Build first
echo "  Building program..."
anchor build 2>&1 | tail -1

# Deploy to devnet
echo "  Deploying to devnet..."
DEPLOY_OUTPUT=$(anchor deploy --provider.cluster devnet 2>&1)
PROGRAM_ID=$(echo "$DEPLOY_OUTPUT" | sed -n 's/.*Program Id: \([^ ]*\).*/\1/p')

if [ -z "$PROGRAM_ID" ]; then
  # Fallback: read from Anchor.toml or keypair
  PROGRAM_ID=$(solana address -k target/deploy/seedpay-keypair.json)
fi

echo "  ✓ Program deployed: $PROGRAM_ID"
echo "  ✓ Explorer: $EXPLORER/address/$PROGRAM_ID?cluster=$CLUSTER"

# ── Step 2: Generate keypairs ────────────────────────────

echo ""
echo "  ── Step 2: Generate Keypairs ───────────────────────"

mkdir -p "$KEYS_DIR"

# Generate leecher keypair (or reuse existing)
LEECHER_KEY="$KEYS_DIR/leecher.json"
if [ ! -f "$LEECHER_KEY" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$LEECHER_KEY" --force >/dev/null 2>&1
  echo "  ✓ Leecher keypair generated"
else
  echo "  ✓ Leecher keypair exists (reusing)"
fi
LEECHER_PUBKEY=$(solana address -k "$LEECHER_KEY")
echo "    $LEECHER_PUBKEY"

# Generate seeder keypair (or reuse existing)
SEEDER_KEY="$KEYS_DIR/seeder.json"
if [ ! -f "$SEEDER_KEY" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$SEEDER_KEY" --force >/dev/null 2>&1
  echo "  ✓ Seeder keypair generated"
else
  echo "  ✓ Seeder keypair exists (reusing)"
fi
SEEDER_PUBKEY=$(solana address -k "$SEEDER_KEY")
echo "    $SEEDER_PUBKEY"

# Generate mint authority (or reuse existing)
MINT_AUTH_KEY="$KEYS_DIR/mint-authority.json"
if [ ! -f "$MINT_AUTH_KEY" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$MINT_AUTH_KEY" --force >/dev/null 2>&1
  echo "  ✓ Mint authority keypair generated"
else
  echo "  ✓ Mint authority keypair exists (reusing)"
fi
MINT_AUTH_PUBKEY=$(solana address -k "$MINT_AUTH_KEY")

# ── Step 3: Airdrop SOL ─────────────────────────────────

echo ""
echo "  ── Step 3: Airdrop SOL ─────────────────────────────"

airdrop_if_needed() {
  local pubkey=$1
  local name=$2
  local balance
  balance=$(solana balance "$pubkey" 2>/dev/null | awk '{print $1}' || echo "0")

  if (( $(echo "$balance < 0.5" | bc -l 2>/dev/null || echo 1) )); then
    echo "  Airdropping 1 SOL to $name..."
    solana airdrop 1 "$pubkey" >/dev/null 2>&1 || echo "  ⚠ Airdrop may have failed (rate limited)"
    sleep 2
    balance=$(solana balance "$pubkey" 2>/dev/null | awk '{print $1}' || echo "?")
  fi
  echo "  ✓ $name: $balance SOL"
}

airdrop_if_needed "$LEECHER_PUBKEY" "Leecher"
airdrop_if_needed "$SEEDER_PUBKEY" "Seeder"
airdrop_if_needed "$MINT_AUTH_PUBKEY" "Mint Authority"

# ── Step 4: Create test USDC mint ────────────────────────

echo ""
echo "  ── Step 4: Create Test USDC Mint ───────────────────"

MINT_KEY_FILE="$KEYS_DIR/usdc-mint.json"

if [ -f "$MINT_KEY_FILE" ]; then
  MINT_PUBKEY=$(solana address -k "$MINT_KEY_FILE")
  # Check if mint exists on-chain
  if solana account "$MINT_PUBKEY" >/dev/null 2>&1; then
    echo "  ✓ Test USDC mint exists (reusing): $MINT_PUBKEY"
  else
    echo "  Mint keypair exists but not on-chain. Recreating..."
    rm "$MINT_KEY_FILE"
  fi
fi

if [ ! -f "$MINT_KEY_FILE" ]; then
  solana-keygen new --no-bip39-passphrase --outfile "$MINT_KEY_FILE" --force >/dev/null 2>&1
  MINT_PUBKEY=$(solana address -k "$MINT_KEY_FILE")

  spl-token create-token \
    --decimals 6 \
    --mint-authority "$MINT_AUTH_PUBKEY" \
    "$MINT_KEY_FILE" \
    >/dev/null 2>&1

  echo "  ✓ Test USDC mint created: $MINT_PUBKEY"
fi

echo "  ✓ Explorer: $EXPLORER/address/$MINT_PUBKEY?cluster=$CLUSTER"

# ── Step 5: Create token accounts + mint ─────────────────

echo ""
echo "  ── Step 5: Create Token Accounts & Fund Leecher ────"

# Create or get associated token accounts
create_token_account() {
  local owner_key=$1
  local owner_name=$2
  local ata

  ata=$(spl-token create-account "$MINT_PUBKEY" \
    --owner "$(solana address -k "$owner_key")" \
    --fee-payer "$owner_key" \
    2>&1 | sed -n 's/.*Creating account \([^ ]*\).*/\1/p')

  if [ -z "$ata" ]; then
    # Account likely already exists, fetch it
    ata=$(spl-token accounts --owner "$(solana address -k "$owner_key")" "$MINT_PUBKEY" 2>/dev/null \
      | awk 'NF && !/^[[:space:]]*$/ {print $1}' | head -1 || true)
  fi

  echo "$ata"
}

LEECHER_TOKEN=$(create_token_account "$LEECHER_KEY" "Leecher")
echo "  ✓ Leecher token account: $LEECHER_TOKEN"

SEEDER_TOKEN=$(create_token_account "$SEEDER_KEY" "Seeder")
echo "  ✓ Seeder token account: $SEEDER_TOKEN"

# Mint 1 USDC (1,000,000 base units) to leecher
echo "  Minting 1.0 Test USDC to leecher..."
spl-token mint "$MINT_PUBKEY" 1 \
  --recipient "$LEECHER_TOKEN" \
  --mint-authority "$MINT_AUTH_KEY" \
  >/dev/null 2>&1 || echo "  ⚠ Mint may have failed (check balances manually)"

LEECHER_BALANCE=$(spl-token balance --address "$LEECHER_TOKEN" 2>/dev/null || echo "?")
echo "  ✓ Leecher USDC balance: $LEECHER_BALANCE"

# ── Step 6: Write .env.devnet ────────────────────────────

echo ""
echo "  ── Step 6: Write .env.devnet ───────────────────────"

cat > "$ENV_FILE" <<EOF
# SeedPay Devnet Configuration
# Generated by setup-devnet.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
#
# DO NOT COMMIT THIS FILE — contains paths to private keys

CLUSTER=devnet
RPC_URL=$RPC_URL
PROGRAM_ID=$PROGRAM_ID

# Keypair file paths
LEECHER_KEYPAIR=$LEECHER_KEY
SEEDER_KEYPAIR=$SEEDER_KEY
MINT_AUTHORITY_KEYPAIR=$MINT_AUTH_KEY

# Public keys
LEECHER_PUBKEY=$LEECHER_PUBKEY
SEEDER_PUBKEY=$SEEDER_PUBKEY
MINT_PUBKEY=$MINT_PUBKEY
MINT_AUTHORITY_PUBKEY=$MINT_AUTH_PUBKEY

# Token accounts
LEECHER_TOKEN_ACCOUNT=$LEECHER_TOKEN
SEEDER_TOKEN_ACCOUNT=$SEEDER_TOKEN
EOF

echo "  ✓ Saved to .env.devnet"

# ── Summary ──────────────────────────────────────────────

echo ""
echo "  ═══════════════════════════════════════════════════════"
echo "    Setup Complete!"
echo "  ═══════════════════════════════════════════════════════"
echo ""
echo "    Program:  $PROGRAM_ID"
echo "    Mint:     $MINT_PUBKEY"
echo "    Leecher:  $LEECHER_PUBKEY"
echo "    Seeder:   $SEEDER_PUBKEY"
echo ""
echo "    Explorer links:"
echo "    Program:  $EXPLORER/address/$PROGRAM_ID?cluster=$CLUSTER"
echo "    Mint:     $EXPLORER/address/$MINT_PUBKEY?cluster=$CLUSTER"
echo "    Leecher:  $EXPLORER/address/$LEECHER_PUBKEY?cluster=$CLUSTER"
echo "    Seeder:   $EXPLORER/address/$SEEDER_PUBKEY?cluster=$CLUSTER"
echo ""
echo "    Next: Run the demo with ./scripts/demo.sh"
echo ""