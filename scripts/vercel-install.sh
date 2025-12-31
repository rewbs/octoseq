#!/bin/bash
# Vercel-specific install script
# This script ensures Vercel uses the published npm packages for @octoseq/visualiser,
# @octoseq/mir, and @octoseq/wavesurfer-signalviewer instead of trying to build them
# from the workspace.
#
# It uses the 'dev' npm tag to get the latest prerelease version (with git SHA).
# It includes retry logic to handle the race condition where GitHub Actions
# may still be publishing packages when Vercel starts building.
#
# If the matching SHA isn't found after a timeout, it falls back to the latest
# dev version (this handles commits that don't trigger the publish workflow).

set -e

# Retry settings for waiting for matching SHA
MAX_RETRIES=12
RETRY_DELAY=10

get_latest_dev_version() {
    local package_name=$1
    npm view "$package_name" dist-tags.dev 2>/dev/null || echo ""
}

# Check if the current commit affects paths that trigger package publishing
# Must match the paths in .github/workflows/build-and-publish.yml
commit_triggers_publish() {
    # Get list of changed files in this commit compared to parent
    local changed_files
    changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")

    if [ -z "$changed_files" ]; then
        # Can't determine - assume it does trigger
        return 0
    fi

    # Check if any changed file matches the workflow trigger paths
    # These must stay in sync with .github/workflows/build-and-publish.yml
    if echo "$changed_files" | grep -qE '^(apps/web/|packages/(visualiser|mir|wavesurfer-signalviewer)/|\.github/workflows/build-and-publish\.yml$)'; then
        return 0  # true - triggers publish
    else
        return 1  # false - doesn't trigger publish
    fi
}

# Wait for a package to be available on npm with the expected SHA
# Args: package_name, expected_sha, skip_wait (true/false)
wait_for_package() {
    local package_name=$1
    local expected_sha=$2
    local skip_wait=$3
    local attempt=1

    echo "    Looking for $package_name with SHA $expected_sha..." >&2

    # If we're skipping wait, go straight to fallback
    if [ "$skip_wait" = "true" ]; then
        local fallback_version=$(get_latest_dev_version "$package_name")
        if [ -n "$fallback_version" ]; then
            echo "    Using latest dev (commit doesn't trigger publish): $fallback_version" >&2
            echo "$fallback_version"
            return 0
        fi
        echo "    ERROR: No dev version available for $package_name" >&2
        return 1
    fi

    while [ $attempt -le $MAX_RETRIES ]; do
        local dev_version=$(get_latest_dev_version "$package_name")

        if [ -n "$dev_version" ]; then
            # Check if the dev version contains our expected SHA
            if [[ "$dev_version" == *"$expected_sha"* ]]; then
                echo "    Found $package_name@$dev_version (matches SHA)" >&2
                echo "$dev_version"
                return 0
            else
                echo "    Attempt $attempt/$MAX_RETRIES: Found $dev_version but expecting SHA $expected_sha, waiting ${RETRY_DELAY}s..." >&2
            fi
        else
            echo "    Attempt $attempt/$MAX_RETRIES: No dev version found yet, waiting ${RETRY_DELAY}s..." >&2
        fi

        sleep $RETRY_DELAY
        attempt=$((attempt + 1))
    done

    # Fallback: use whatever dev version is available
    local fallback_version=$(get_latest_dev_version "$package_name")
    if [ -n "$fallback_version" ]; then
        echo "    WARNING: SHA $expected_sha not found, falling back to latest dev: $fallback_version" >&2
        echo "$fallback_version"
        return 0
    fi

    echo "    ERROR: No dev version available for $package_name" >&2
    return 1
}

echo "==> Vercel Install: Configuring for npm-published packages..."

# Get the current git SHA (short form)
CURRENT_SHA=$(git rev-parse --short=7 HEAD)
echo "    Current commit SHA: $CURRENT_SHA"

# Check if this commit should trigger a publish
SKIP_WAIT="false"
if commit_triggers_publish; then
    echo "    Commit affects package paths - will wait for matching SHA"
else
    echo "    Commit doesn't affect package paths - using latest dev versions"
    SKIP_WAIT="true"
fi

# Wait for packages to be available on npm (concurrently)
echo "==> Checking npm package availability..."
TEMP_DIR=$(mktemp -d)

# Start all waits in background, stdout (version) goes to temp files, stderr passes through
wait_for_package "@octoseq/visualiser" "$CURRENT_SHA" "$SKIP_WAIT" > "$TEMP_DIR/visualiser_version" &
PID_VISUALISER=$!
wait_for_package "@octoseq/mir" "$CURRENT_SHA" "$SKIP_WAIT" > "$TEMP_DIR/mir_version" &
PID_MIR=$!
wait_for_package "@octoseq/wavesurfer-signalviewer" "$CURRENT_SHA" "$SKIP_WAIT" > "$TEMP_DIR/signalviewer_version" &
PID_SIGNALVIEWER=$!

# Wait for all and capture exit codes
wait $PID_VISUALISER
VISUALISER_EXIT=$?
wait $PID_MIR
MIR_EXIT=$?
wait $PID_SIGNALVIEWER
SIGNALVIEWER_EXIT=$?

# Check for failures
if [ "$VISUALISER_EXIT" != "0" ]; then
    echo "ERROR: Failed to resolve @octoseq/visualiser" >&2
    rm -rf "$TEMP_DIR"
    exit 1
fi
if [ "$MIR_EXIT" != "0" ]; then
    echo "ERROR: Failed to resolve @octoseq/mir" >&2
    rm -rf "$TEMP_DIR"
    exit 1
fi
if [ "$SIGNALVIEWER_EXIT" != "0" ]; then
    echo "ERROR: Failed to resolve @octoseq/wavesurfer-signalviewer" >&2
    rm -rf "$TEMP_DIR"
    exit 1
fi

VISUALISER_VERSION=$(cat "$TEMP_DIR/visualiser_version")
MIR_VERSION=$(cat "$TEMP_DIR/mir_version")
SIGNALVIEWER_VERSION=$(cat "$TEMP_DIR/signalviewer_version")
rm -rf "$TEMP_DIR"

echo "    Resolved versions:"
echo "      @octoseq/visualiser@$VISUALISER_VERSION"
echo "      @octoseq/mir@$MIR_VERSION"
echo "      @octoseq/wavesurfer-signalviewer@$SIGNALVIEWER_VERSION"

# Create a temporary pnpm-workspace.yaml that excludes all @octoseq packages
echo "==> Excluding visualiser, mir, and wavesurfer-signalviewer from workspace..."
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
pkg.dependencies['@octoseq/wavesurfer-signalviewer'] = '${SIGNALVIEWER_VERSION}';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('    Updated @octoseq/visualiser to: ${VISUALISER_VERSION}');
console.log('    Updated @octoseq/mir to: ${MIR_VERSION}');
console.log('    Updated @octoseq/wavesurfer-signalviewer to: ${SIGNALVIEWER_VERSION}');
"

# Brief delay to allow npm registry CDN propagation
echo "==> Waiting for npm registry propagation..."
sleep 5

# Run pnpm install (--no-frozen-lockfile because we modified package.json)
echo "==> Running pnpm install..."
pnpm install --no-frozen-lockfile

# Debug: verify packages were installed
echo "==> Verifying installed packages..."
echo "    apps/web/package.json dependencies:"
node -e "console.log(JSON.stringify(require('./apps/web/package.json').dependencies, null, 2))"
echo "    Checking node_modules symlinks..."
ls -la apps/web/node_modules/@octoseq/ 2>/dev/null || echo "    WARNING: @octoseq not found in apps/web/node_modules"
echo "    Checking actual visualiser package contents..."
VISUALISER_PATH=$(find node_modules/.pnpm -type d -name "@octoseq+visualiser*" 2>/dev/null | head -1)
if [ -n "$VISUALISER_PATH" ]; then
    echo "    Found at: $VISUALISER_PATH"
    ls -la "$VISUALISER_PATH/node_modules/@octoseq/visualiser/" 2>/dev/null || echo "    WARNING: visualiser dir not found"
    ls -la "$VISUALISER_PATH/node_modules/@octoseq/visualiser/pkg/" 2>/dev/null || echo "    WARNING: pkg dir not found"
else
    echo "    WARNING: visualiser not found in .pnpm"
fi

echo "==> Vercel Install: Complete!"
