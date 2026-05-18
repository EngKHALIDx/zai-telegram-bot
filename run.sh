#!/bin/bash
cd "$(dirname "$0")"

# Z.ai Agent v18.2 - Local Runner (for development only)
# Production runs on GitHub Actions only
#
# Usage: Create a .env file with your secrets (see .env.example)
# Then run: ./run.sh

if [ ! -f .env ]; then
  echo "ERROR: .env file not found!"
  echo "Copy .env.example to .env and fill in your values:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  exit 1
fi

# Load environment variables from .env
set -a
source .env
set +a

echo "[$(date)] Starting Z.ai Agent v18.2 (local dev mode)..."

# Auto-restart loop
while true; do
  echo "[$(date)] Starting bot..."
  npx tsx src/index.ts 2>&1
  EXIT_CODE=$?
  echo "[$(date)] Bot exited with code $EXIT_CODE, restarting in 5s..."
  sleep 5
done
