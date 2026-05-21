#!/usr/bin/env bash
set -euo pipefail

# Load nvm if available (needed for non-interactive SSH sessions)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

APP_NAME="${APP_NAME:-GPT2Image-Pro}"
APP_DIR="${APP_DIR:-$(pwd)}"
PORT="${PORT:-3303}"
PACKAGE_MANAGER="${PACKAGE_MANAGER:-pnpm}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_BUILD="${SKIP_BUILD:-1}"
TAR_FILE="${TAR_FILE:-deploy.tgz}"
FORCE_EXTRACT="${FORCE_EXTRACT:-1}"
ASSET_PREFIX="${ASSET_PREFIX:-${NEXT_PUBLIC_ASSET_PREFIX:-}}"
STANDALONE_APP_DIR="${STANDALONE_APP_DIR:-}"

cd "$APP_DIR"
export NODE_ENV=production
export PORT="$PORT"
[ -n "$ASSET_PREFIX" ] && export NEXT_PUBLIC_ASSET_PREFIX="$ASSET_PREFIX"

if [ -z "$STANDALONE_APP_DIR" ]; then
  if [ -d "apps/web/.next/standalone/apps/web" ]; then
    STANDALONE_APP_DIR="apps/web/.next/standalone/apps/web"
  elif [ -d "apps/web/.next/standalone/$APP_NAME/apps/web" ]; then
    STANDALONE_APP_DIR="apps/web/.next/standalone/$APP_NAME/apps/web"
  else
    STANDALONE_APP_DIR="apps/web/.next/standalone/apps/web"
  fi
fi

if [ "$SKIP_INSTALL" != "1" ]; then
  if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
    pnpm install --prod
  elif [ -f package-lock.json ]; then
    npm ci --omit=dev
  elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
    yarn install --production --frozen-lockfile
  else
    npm install --omit=dev
  fi
fi

if [ "$SKIP_BUILD" != "1" ]; then
  if [ "$PACKAGE_MANAGER" = "pnpm" ] && command -v pnpm >/dev/null 2>&1; then
    pnpm run build
  elif [ "$PACKAGE_MANAGER" = "yarn" ] && command -v yarn >/dev/null 2>&1; then
    yarn build
  else
    npm run build
  fi
else
  if [ -f "$TAR_FILE" ] && [ "$FORCE_EXTRACT" = "1" ]; then
    rm -rf .next
    tar -xzf "$TAR_FILE"
  fi
  if [ ! -d .next ]; then
    if [ -f "$TAR_FILE" ] && [ "$FORCE_EXTRACT" != "1" ]; then
      tar -xzf "$TAR_FILE"
    else
      echo ".next not found and $TAR_FILE not found. Upload build artifacts first."
      exit 1
    fi
  fi
  if [ ! -d .next ]; then
    echo ".next not found after extracting $TAR_FILE."
    exit 1
  fi
fi

if [ -d "apps/web/.next/static" ]; then
  if [ ! -d "$STANDALONE_APP_DIR/.next" ]; then
    echo "Standalone .next directory not found: $STANDALONE_APP_DIR/.next"
    exit 1
  fi
  rm -rf "$STANDALONE_APP_DIR/.next/static"
  mkdir -p "$STANDALONE_APP_DIR/.next/static"
  cp -a apps/web/.next/static/. "$STANDALONE_APP_DIR/.next/static/"
fi

if [ -d "apps/web/.next/server" ]; then
  if [ ! -d "$STANDALONE_APP_DIR/.next" ]; then
    echo "Standalone .next directory not found: $STANDALONE_APP_DIR/.next"
    exit 1
  fi
  rm -rf "$STANDALONE_APP_DIR/.next/server"
  mkdir -p "$STANDALONE_APP_DIR/.next/server"
  cp -a apps/web/.next/server/. "$STANDALONE_APP_DIR/.next/server/"
fi

if command -v pm2 >/dev/null 2>&1; then
  # Kill any stale nohup process on the same port
  lsof -ti:"$PORT" | xargs -r kill -9 2>/dev/null || true
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME" --update-env
  else
    pm2 start node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$PORT"
  fi
  pm2 save
  echo "App '$APP_NAME' is running on port $PORT (pm2)"
else
  echo "pm2 not found. Install: npm i -g pm2"
  echo "Starting with nohup as fallback..."
  lsof -ti:"$PORT" | xargs -r kill -9 2>/dev/null || true
  nohup node node_modules/next/dist/bin/next start -p "$PORT" > /tmp/"$APP_NAME".log 2>&1 &
  echo "App '$APP_NAME' started on port $PORT (pid: $!)"
fi
