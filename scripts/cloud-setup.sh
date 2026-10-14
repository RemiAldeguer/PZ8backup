#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Planzone 8 nécessite Node.js 24 ou supérieur.")'
npm ci --cache /tmp/planzone8-npm-cache --no-audit --no-fund
npm run build
npm test
