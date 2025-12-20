#!/bin/bash
# Vercel-specific install script
# This script ensures Vercel uses the published npm packages for @octoseq/visualiser
# and @octoseq/mir instead of trying to build them from the workspace.
#
# It uses the 'dev' npm tag to get the latest prerelease version (with git SHA).
# It includes retry logic to handle the race condition where GitHub Actions
# may still be publishing packages when Vercel starts building.

set -e

MAX_RETRIES=30
RETRY_DELAY=10

get_latest_dev_version() {
    local package_name=$1
    npm view "$package_name" dist-tags.dev 2>/dev/null || echo ""
}

wait_for_package() {
    local package_name=$1
    local expected_sha=$2
    local attempt=1

    echo "    Waiting for $package_name with SHA $expected_sha on npm..."

    while [ $attempt -le $MAX_RETRIES ]; do
        local dev_version=$(get_latest_dev_version "$package_name")

        if [ -n "$dev_version" ]; then
            # Check if the dev version contains our expected SHA
            if [[ "$dev_version" == *"$expected_sha"* ]]; then
                echo "    Found $package_name@$dev_version (matches SHA)"
                echo "$dev_version"
                return 0
            else
                echo "    Attempt $attempt/$MAX_RETRIES: Found $dev_version but expecting SHA $expected_sha, waiting ${RETRY_DELAY}s..."
            fi
        else
            echo "    Attempt $attempt/$MAX_RETRIES: No dev version found yet, waiting ${RETRY_DELAY}s..."
        fi

        echo -n "."
        sleep $RETRY_DELAY
        attempt=$((attempt + 1))
    done

    echo "    ERROR: Timed out waiting for $package_name with SHA $expected_sha"
    return 1
}

echo "==> Vercel Install: Configuring for npm-published packages..."

# Get the current git SHA (short form)
CURRENT_SHA=$(git rev-parse --short=7 HEAD)
echo "    Current commit SHA: $CURRENT_SHA"

# Wait for packages to be available on npm with the current SHA
echo "==> Checking npm package availability..."
VISUALISER_VERSION=$(wait_for_package "@octoseq/visualiser" "$CURRENT_SHA")
MIR_VERSION=$(wait_for_package "@octoseq/mir" "$CURRENT_SHA")

echo "    Resolved versions:"
echo "      @octoseq/visualiser@$VISUALISER_VERSION"
echo "      @octoseq/mir@$MIR_VERSION"

# Create a temporary pnpm-workspace.yaml that excludes both packages
echo "==> Excluding visualiser and mir from workspace..."
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
EOF

# Update apps/web/package.json to use the resolved npm versions
echo "==> Updating apps/web to use npm packages..."
node -e "
const fs = require('fs');
const pkgPath = './apps/web/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@octoseq/visualiser'] = '${VISUALISER_VERSION}';
pkg.dependencies['@octoseq/mir'] = '${MIR_VERSION}';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('    Updated @octoseq/visualiser to: ${VISUALISER_VERSION}');
console.log('    Updated @octoseq/mir to: ${MIR_VERSION}');
"

# Run pnpm install
echo "==> Running pnpm install..."
pnpm install

echo "==> Vercel Install: Complete!"
