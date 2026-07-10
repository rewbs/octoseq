#!/bin/bash

# Check if DATABASE_URL is set
if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL is not set. Set it to the database you intend to migrate."
  exit 1
fi

if [[ "$ALLOW_PRODUCTION_MIGRATIONS" != "true" ]]; then
  echo "Error: set ALLOW_PRODUCTION_MIGRATIONS=true after verifying DATABASE_URL."
  exit 1
fi

if [[ "$PRISMA_BASELINE_EXISTING_DATABASE" == "true" ]]; then
  echo "Marking the pre-migration schema as an applied baseline..."
  pnpm exec prisma migrate resolve --applied 20260710000000_baseline
fi

pnpm exec prisma migrate deploy
