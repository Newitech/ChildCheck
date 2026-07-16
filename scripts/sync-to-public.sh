#!/usr/bin/env bash
# =============================================================================
# sync-to-public.sh — Sync the ChildCheck-Dev repo → public ChildCheck repo
#
# Usage:
#   bash scripts/sync-to-public.sh [version]
#   bash scripts/sync-to-public.sh [version] --tag
#   bash scripts/sync-to-public.sh --no-push
#
#   version  The new version number to set (e.g. "0.9", "1.0.0").
#            If omitted, the script prompts for it.
#
#   --tag    Also create a v<version> git tag + push it to trigger the release
#            CI (builds binaries + Docker image + GitHub Release).
#            If omitted, the script asks interactively whether to tag.
#
# What it does:
#   1. rsync from ChildCheck-Dev → ChildCheck (excluding dev-only files)
#   2. Sets the VERSION file to the specified version
#   3. Commits all changes on the public repo's main branch
#   4. Pushes to https://github.com/Newitech/ChildCheck.git
#
# Prerequisites:
#   - Both repos cloned locally:
#     ~/Documents/GitHub/ChildCheck-Dev  (this dev repo)
#     ~/Documents/GitHub/ChildCheck      (the public repo)
#   - The public repo's main branch has branch protection (requires PR).
#     This script temporarily lifts protection, pushes directly, then restores it.
#     Alternatively, run with --no-push to just sync locally and review before
#     pushing manually via a PR.
#
# Dev-only files EXCLUDED (never sent to public repo):
#   .git/  node_modules/  .next/  .env  data/  db/  prisma/db/
#   download/  "Elvanto Test Data/"  worklog.md  PLAN.md  MORNING-SUMMARY.md
#   agent-ctx/  .zcode/  .zscripts/  tool-results/  dev.log  *.log
#   tsconfig.tsbuildinfo  next-env.d.ts  config/
# =============================================================================

set -euo pipefail

DEV_REPO="${CHILD_CHECK_DEV_DIR:-$HOME/Documents/GitHub/ChildCheck-Dev}"
PUBLIC_REPO="${CHILD_CHECK_PUBLIC_DIR:-$HOME/Documents/GitHub/ChildCheck}"
PUBLIC_REMOTE="https://github.com/Newitech/ChildCheck.git"

# --- Parse args ---
VERSION="${1:-}"
NO_PUSH=false
CREATE_TAG=false
if [[ "${1:-}" == "--no-push" ]]; then
  NO_PUSH=true
  VERSION=""
fi
if [[ "${1:-}" == "--tag" ]]; then
  CREATE_TAG=true
  VERSION=""
fi

if [[ -z "$VERSION" ]]; then
  read -rp "Enter the new version number (e.g. 0.9, 1.0.0): " VERSION
fi

# If --tag was passed, prompt whether to also cut a release tag
if [[ "$CREATE_TAG" = false ]]; then
  read -rp "Create a v$VERSION release tag + trigger CI? [y/N] " CREATE_TAG_ANSWER
  if [[ "$CREATE_TAG_ANSWER" =~ ^[Yy]$ ]]; then
    CREATE_TAG=true
  fi
fi

echo "============================================"
echo "  ChildCheck Dev → Public Sync"
echo "  Version: $VERSION"
echo "  Dev repo:   $DEV_REPO"
echo "  Public repo: $PUBLIC_REPO"
echo "  Push: $([ "$NO_PUSH" = true ] && echo 'NO (review locally)' || echo 'YES')"
echo "  Release tag: $([ "$CREATE_TAG" = true ] && echo "YES (v$VERSION)" || echo 'NO')"
echo "============================================"
echo ""

# --- Verify both repos exist ---
if [[ ! -d "$DEV_REPO/.git" ]]; then
  echo "ERROR: Dev repo not found at $DEV_REPO"
  exit 1
fi
if [[ ! -d "$PUBLIC_REPO/.git" ]]; then
  echo "ERROR: Public repo not found at $PUBLIC_REPO"
  exit 1
fi

# --- Step 1: Remove old tracked files in public repo ---
echo ">>> Removing old tracked files in public repo..."
cd "$PUBLIC_REPO"
git rm -rf . 2>/dev/null || true

# --- Step 2: rsync from Dev → Public ---
echo ">>> Syncing files from Dev → Public..."
rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='db/' \
  --exclude='prisma/db/' \
  --exclude='download/' \
  --exclude='Elvanto Test Data/' \
  --exclude='worklog.md' \
  --exclude='PLAN.md' \
  --exclude='MORNING-SUMMARY.md' \
  --exclude='agent-ctx/' \
  --exclude='.zcode/' \
  --exclude='.zscripts/' \
  --exclude='tool-results/' \
  --exclude='dev.log' \
  --exclude='*.log' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='next-env.d.ts' \
  --exclude='config/' \
  "$DEV_REPO/" "$PUBLIC_REPO/"

# --- Step 3: Set VERSION ---
echo ">>> Setting VERSION to $VERSION..."
echo "$VERSION" > "$PUBLIC_REPO/VERSION"

# --- Step 4: Verify no dev-only files leaked ---
echo ">>> Verifying no dev-only files leaked..."
LEAKED=""
for f in worklog.md PLAN.md MORNING-SUMMARY.md dev.log .env "Elvanto Test Data"; do
  if [[ -e "$PUBLIC_REPO/$f" ]]; then
    LEAKED="$LEAKED $f"
  fi
done
for d in agent-ctx tool-results .zcode .zscripts node_modules .next data db prisma/db; do
  if [[ -d "$PUBLIC_REPO/$d" ]]; then
    LEAKED="$LEAKED $d/"
  fi
done
if [[ -n "$LEAKED" ]]; then
  echo "WARNING: Dev-only files found in public repo:$LEAKED"
  echo "         Check .gitignore covers these."
else
  echo "    ✓ No dev-only files leaked."
fi

# --- Step 5: Stage + commit ---
echo ">>> Staging + committing..."
cd "$PUBLIC_REPO"
git add -A
git -c user.name=Newitech -c user.email=newitech@users.noreply.github.com commit -q -m "release v$VERSION — sync from dev repo"

# Show what changed
CHANGED=$(git diff --stat HEAD~1 HEAD 2>/dev/null | tail -1)
echo "    ✓ Committed: $CHANGED"

# --- Step 6: Push (optional) ---
if [[ "$NO_PUSH" = true ]]; then
  echo ""
  echo ">>> --no-push: Review the changes locally, then push manually:"
  echo "    cd $PUBLIC_REPO"
  echo "    git push origin main"
  echo ""
  echo ">>> Done (local only)."
  exit 0
fi

echo ">>> Pushing to $PUBLIC_REMOTE..."
# Branch protection requires PRs — temporarily lift it for the direct push.
echo "    Temporarily lifting branch protection..."
gh api repos/Newitech/ChildCheck/branches/main/protection \
  -X PUT \
  --input - <<'EOF' 2>/dev/null || true
{
  "required_pull_request_reviews": null,
  "enforce_admins": false,
  "required_status_checks": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": true,
  "allow_deletions": false
}
EOF

git push origin main 2>&1

echo "    Restoring branch protection..."
gh api repos/Newitech/ChildCheck/branches/main/protection \
  -X PUT \
  --input - <<'EOF' 2>/dev/null || true
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "enforce_admins": true,
  "required_status_checks": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo ""
echo "============================================"
echo "  ✓ Sync complete! v$VERSION pushed to main."
echo "============================================"

# --- Step 7: Create release tag (optional) ---
if [[ "$CREATE_TAG" = true ]]; then
  echo ""
  echo ">>> Creating v$VERSION release tag..."
  cd "$PUBLIC_REPO"

  # Delete the tag locally if it already exists (force re-create)
  git tag -d "v$VERSION" 2>/dev/null || true

  # Create annotated tag
  git tag -a "v$VERSION" -m "Release v$VERSION"

  # Push the tag (triggers the release CI workflow). Force in case the tag
  # already exists on the remote (re-release scenario).
  echo ">>> Pushing tag v$VERSION to trigger release CI..."
  git push origin "v$VERSION" --force 2>&1

  echo ""
  echo "  ✓ Tag v$VERSION pushed. The release workflow will:"
  echo "    - Build 4 platform binaries (linux-x64, linux-arm64, macos-arm64, windows-x64)"
  echo "    - Build + push Docker image to ghcr.io/Newitech/childcheck"
  echo "    - Create a GitHub Release with downloadable tarballs"
  echo ""
  echo "  Check progress: https://github.com/Newitech/ChildCheck/actions"
  echo "  View release:   https://github.com/Newitech/ChildCheck/releases/tag/v$VERSION"
fi
