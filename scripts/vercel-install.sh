#!/bin/bash
# Vercel-specific install script
# This script ensures Vercel uses the published npm packages for @octoseq/visualiser
# and @octoseq/mir instead of trying to build them from the workspace.

set -e

echo "==> Vercel Install: Configuring for npm-published packages..."

# Get the versions from package.json files
VISUALISER_VERSION=$(node -p "require('./packages/visualiser/package.json').version")
MIR_VERSION=$(node -p "require('./packages/mir/package.json').version")
echo "    Target versions:"
echo "      @octoseq/visualiser@$VISUALISER_VERSION"
echo "      @octoseq/mir@$MIR_VERSION"

# Create a temporary pnpm-workspace.yaml that excludes both packages
echo "==> Excluding visualiser and mir from workspace..."
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
EOF

# Update apps/web/package.json to use the npm versions instead of workspace:*
echo "==> Updating apps/web to use npm packages..."
node -e "
const fs = require('fs');
const pkgPath = './apps/web/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@octoseq/visualiser'] = '^${VISUALISER_VERSION}';
pkg.dependencies['@octoseq/mir'] = '^${MIR_VERSION}';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('    Updated @octoseq/visualiser to: ^${VISUALISER_VERSION}');
console.log('    Updated @octoseq/mir to: ^${MIR_VERSION}');
"

# Run pnpm install
echo "==> Running pnpm install..."
pnpm install

echo "==> Vercel Install: Complete!"
