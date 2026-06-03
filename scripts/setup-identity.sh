#!/usr/bin/env bash
# Create a testnet identity and fund it via Friendbot
# Usage: bash scripts/setup-identity.sh [name]

set -euo pipefail

NAME="${1:-veritoken-dev}"
NETWORK="testnet"

echo "==> Generating identity: $NAME"
stellar keys generate --network $NETWORK $NAME || echo "    (already exists)"

ADDR=$(stellar keys address $NAME)
echo "    Address: $ADDR"

echo "==> Funding via Friendbot..."
curl -s "https://friendbot.stellar.org?addr=$ADDR" | python3 -m json.tool | grep -E '"hash"|"status"' || true

echo ""
echo "Done! Use '$NAME' as your identity in deploy.sh"
