#!/usr/bin/env bash
# Veritoken deployment script — Stellar Testnet
# Usage: bash scripts/deploy.sh [identity-name]
# Requires: stellar CLI, cargo, wasm32 target

set -euo pipefail

NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${1:-alice}"
SOURCE="--source-account $IDENTITY --network $NETWORK"

echo "==> Building all contracts..."
cargo build --release --target wasm32-unknown-unknown

WASM_DIR="target/wasm32-unknown-unknown/release"

build_wasm() {
  local name="$1"
  echo "--- Optimizing $name.wasm"
  stellar contract optimize --wasm "$WASM_DIR/${name//-/_}.wasm" 2>/dev/null || true
}

build_wasm kyc_registry
build_wasm compliance_engine
build_wasm invoice_token
build_wasm property_token
build_wasm carbon_credit_token

echo ""
echo "==> Deploying KYC Registry..."
KYC_ID=$(stellar contract deploy \
  $SOURCE \
  --wasm "$WASM_DIR/kyc_registry.wasm" \
  -- \
  --admin "$(stellar keys address $IDENTITY)")
echo "    KYC_REGISTRY_ID=$KYC_ID"

echo "==> Deploying Compliance Engine..."
CE_ID=$(stellar contract deploy \
  $SOURCE \
  --wasm "$WASM_DIR/compliance_engine.wasm" \
  -- \
  --admin "$(stellar keys address $IDENTITY)")
echo "    COMPLIANCE_ENGINE_ID=$CE_ID"

echo "==> Deploying Invoice Token..."
INV_ID=$(stellar contract deploy \
  $SOURCE \
  --wasm "$WASM_DIR/invoice_token.wasm")
echo "    INVOICE_TOKEN_ID=$INV_ID"

echo "==> Deploying Property Token..."
PROP_ID=$(stellar contract deploy \
  $SOURCE \
  --wasm "$WASM_DIR/property_token.wasm")
echo "    PROPERTY_TOKEN_ID=$PROP_ID"

echo "==> Deploying Carbon Credit Token..."
CARBON_ID=$(stellar contract deploy \
  $SOURCE \
  --wasm "$WASM_DIR/carbon_credit_token.wasm")
echo "    CARBON_TOKEN_ID=$CARBON_ID"

echo ""
echo "==> Writing .env to frontend..."
cat > frontend/.env <<EOF
VITE_STELLAR_NETWORK=$NETWORK
VITE_KYC_REGISTRY_ID=$KYC_ID
VITE_COMPLIANCE_ENGINE_ID=$CE_ID
VITE_INVOICE_TOKEN_ID=$INV_ID
VITE_PROPERTY_TOKEN_ID=$PROP_ID
VITE_CARBON_TOKEN_ID=$CARBON_ID
EOF

echo ""
echo "Done! Contract IDs written to frontend/.env"
echo "Next: cd frontend && npm install && npm run dev"
