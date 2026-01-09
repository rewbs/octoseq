#!/bin/bash

# Check if DATABASE_URL is set
if [[ -z "$DATABASE_URL" ]]; then
  echo "Error: DATABASE_URL is not set. Please set it to the connection string for staging."
  exit 1
fi

# Check if DATABASE_URL contains the required substring
REQUIRED_SUBSTRING="ep-withered-union-af7o38dv"
if [[ "$DATABASE_URL" == *"$REQUIRED_SUBSTRING"* ]]; then
  echo "DATABASE_URL contains the required substring. Running Prisma migrations..."
  pnpx prisma migrate deploy
  if [[ $? -eq 0 ]]; then
    echo "Prisma migrations deployed successfully."
  else
    echo "Error: Prisma migrations failed to deploy."
    exit 1
  fi
else
  echo "DATABASE_URL does not contain the required substring for staging. Skipping Prisma migrations."
fi

