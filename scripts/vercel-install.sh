#!/bin/bash
# Vercel-specific install script
# This script ensures Vercel uses the published npm package for @octoseq/visualiser
# instead of trying to build it from the workspace.

set -e

echo "==> Vercel Install: Configuring for npm-published WASM package..."

# Get the version from the visualiser package.json
VISUALISER_VERSION=$(node -p "require('./packages/visualiser/package.json').version")
echo "    Target version: @octoseq/visualiser@$VISUALISER_VERSION"

# Create a temporary pnpm-workspace.yaml that excludes visualiser
echo "==> Excluding visualiser from workspace..."
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
  - "packages/mir"
EOF

# Update apps/web/package.json to use the npm version instead of workspace:*
echo "==> Updating apps/web to use npm package..."
node -e "
const fs = require('fs');
const pkgPath = './apps/web/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@octoseq/visualiser'] = '^${VISUALISER_VERSION}';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('    Updated dependency to: ^${VISUALISER_VERSION}');
"

# Run pnpm install
echo "==> Running pnpm install..."
pnpm install

echo "==> Vercel Install: Complete!"
