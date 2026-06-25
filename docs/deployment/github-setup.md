# GitHub Setup & Release Process

This guide walks you through setting up the GitHub repositories, pushing the code, and creating your first release so the in-app update checker works.

---

## Repository structure

You'll create **two repositories**:

### 1. Private dev repository (e.g. `childcheck-dev`)
Contains the **entire project** including development context files:
- All source code (`src/`, `prisma/`, `mini-services/`, etc.)
- `PLAN.md`, `worklog.md`, `MORNING-SUMMARY.md`, `docs/`
- `agent-ctx/` (agent context from chat.z.ai)
- `db/.gitkeep` (but NOT `db/custom.db` — gitignored)
- `dev.log` (gitignored)

**Purpose:** Your working copy for development in chat.z.ai. The `.tar` downloads from chat.z.ai go here. The markdown context files (`worklog.md`, `PLAN.md`) allow resuming development across sessions.

### 2. Public release repository (e.g. `childcheck`)
Contains the **installation-facing subset**:
- All source code (same as dev)
- `README.md`, `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`
- `docs/`, `install/`, `scripts/`, `Dockerfile`, `docker-compose.yml`
- `.github/` (workflows, issue templates, PR template)
- **NO** `worklog.md`, `PLAN.md`, `MORNING-SUMMARY.md`, `agent-ctx/` (these are gitignored in the public repo)
- **NO** `db/custom.db` (gitignored)

**Purpose:** The public face of the project. Users clone this, file issues, submit PRs, and download releases.

---

## Step 1 — Create the repositories on GitHub

1. Go to https://github.com/new
2. Create **`childcheck-dev`** (Private) — for development
3. Create **`childcheck`** (Public) — for releases

---

## Step 2 — Push the dev repository

```bash
cd ~/childcheck   # or wherever your project is

# Initialize git (if not already)
git init
git branch -M main

# The .gitignore already excludes db/*.db, data/, .env, node_modules, .next, etc.
# Verify:
cat .gitignore

# Add + commit
git add -A
git commit -m "Initial commit — ChildCheck v1.0.0"

# Add the private dev remote + push
git remote add origin git@github.com:YOUR_USERNAME/childcheck-dev.git
git push -u origin main
```

---

## Step 3 — Push the public repository

The `.gitignore` already excludes dev-only files (`worklog.md`, `PLAN.md`, `MORNING-SUMMARY.md`, `agent-ctx/`). So you can push the same working copy to the public repo:

```bash
# Add the public remote
git remote add public git@github.com:YOUR_USERNAME/childcheck.git

# Push to public
git push public main

# Set the public repo as the default for PRs/issues
git remote set-url origin --push git@github.com:YOUR_USERNAME/childcheck.git
```

Or, if you prefer to keep them as separate clones:
```bash
# Clone the public repo
git clone git@github.com:YOUR_USERNAME/childcheck.git childcheck-public
cd childcheck-public

# Copy the source from your dev copy (excluding dev-only files)
rsync -av --exclude='worklog.md' --exclude='PLAN.md' --exclude='MORNING-SUMMARY.md' \
  --exclude='agent-ctx/' --exclude='db/custom.db' --exclude='.env' \
  --exclude='node_modules/' --exclude='.next/' --exclude='dev.log' \
  ~/childcheck/ ./

git add -A
git commit -m "Initial public release — ChildCheck v1.0.0"
git push origin main
```

---

## Step 4 — Enable GitHub Container Registry (GHCR)

The release workflow pushes Docker images to GHCR. To enable it:

1. Go to your public repo → **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions** → set to **Read and write permissions**
3. Save

---

## Step 5 — Create your first release

The release workflow triggers on tag pushes (`v*`). To create v1.0.0:

```bash
cd ~/childcheck   # your dev or public working copy

# Tag the release
git tag -a v1.0.0 -m "ChildCheck v1.0.0 — initial release"

# Push the tag (this triggers the GitHub Actions release workflow)
git push origin v1.0.0
# (or: git push public v1.0.0 if using separate remotes)
```

**What happens automatically:**
1. GitHub Actions triggers the `.github/workflows/release.yml` workflow
2. It builds the 4 platform binaries (linux-x64, linux-arm64, macos-arm64, windows-x64)
3. It builds the Docker image + pushes to `ghcr.io/YOUR_USERNAME/childcheck:latest` + `:v1.0.0`
4. It creates a GitHub Release with the binary tarballs attached as assets
5. The release is now visible at `https://github.com/YOUR_USERNAME/childcheck/releases/tag/v1.0.0`

**To check the build status:** go to your repo → **Actions** tab. The first build takes ~10-15 minutes.

---

## Step 6 — Test the update checker

Once the GitHub release exists, any ChildCheck installation can check for updates.

### On your Docker installation:

1. Edit `.env` and add:
   ```
   CHILDCHETECK_UPDATE_REPO=YOUR_USERNAME/childcheck
   ```

2. Restart the container:
   ```bash
   docker compose down
   docker compose up -d
   ```

3. Sign in to `/admin` → look for the **Updates** card. It should now show:
   - Current version: `1.0.0`
   - Latest version: `1.0.0`
   - Status: "Up to date ✓"

### To test an actual update:

1. Bump the version in your working copy:
   ```bash
   echo "1.0.1" > VERSION
   git add VERSION
   git commit -m "Bump version to 1.0.1"
   git tag -a v1.0.1 -m "v1.0.1 — test update"
   git push origin v1.0.1
   ```

2. Wait for the GitHub Actions workflow to finish (~10-15 min)

3. On your Docker installation, sign in to `/admin`:
   - The Updates card should now show "v1.0.1 available"
   - Click "View release notes" to see the GitHub release page
   - The update command shown should be: `docker compose pull && docker compose up -d`

4. Apply the update:
   ```bash
   cd ~/childcheck
   docker compose pull && docker compose up -d
   ```
   (This pulls the new image from GHCR + restarts. If you're building locally instead of pulling from GHCR, you'd instead: `git pull && docker compose up -d --build`)

5. After restart, the Updates card should show "Up to date ✓" at v1.0.1.

---

## Step 7 — For users who install from the release tarball (not Docker)

Users who download the release tarball from GitHub use the update script:

```bash
# Check for updates (in the admin console → Updates card)
# Apply:
sudo bash /opt/childcheck/install/childcheck-update.sh

# Or pin to a specific version:
sudo bash /opt/childcheck/install/childcheck-update.sh --version v1.0.1
```

The script:
1. Stops the service
2. Backs up the current binary + DB
3. Downloads the latest release tarball from GitHub
4. Extracts it (preserving data/db/config)
5. Runs `db:push` (schema migration)
6. Restarts the service
7. Health-checks
8. Prints the result + rollback instructions if it failed

---

## Ongoing workflow

For future updates:

```bash
# 1. Make changes in your dev environment (chat.z.ai or local)
# 2. Push to the dev repo
git push origin main

# 3. Push to the public repo
git push public main

# 4. When ready to release:
echo "1.1.0" > VERSION
git add VERSION
git commit -m "Bump version to 1.1.0"
git tag -a v1.1.0 -m "v1.1.0 — feature description"
git push origin v1.1.0
git push public v1.1.0

# 5. GitHub Actions auto-builds + creates the release
# 6. Users see "v1.1.0 available" in their admin console
```

---

## Troubleshooting

**The release workflow fails:**
- Check the Actions tab for error logs
- Common issue: GHCR permissions — ensure Settings → Actions → Workflow permissions = "Read and write"
- Common issue: the `scripts/build-binaries.sh` needs Bun installed in the runner — the workflow uses `oven-sh/setup-bun@v1`

**The update checker shows "disabled":**
- `CHILDCHETECK_UPDATE_REPO` is not set in `.env` — add it + restart
- The env var value must be `owner/repo` (e.g. `childcheck/childcheck`), not a full URL

**The update checker shows an error:**
- GitHub API rate limit (60 requests/hour for unauthenticated) — wait + retry
- The repo doesn't exist or is private — ensure the public repo is accessible

**Docker pull fails:**
- The GHCR image might not be built yet — wait for the Actions workflow to complete
- You may need to `docker login ghcr.io` if the package is private (default for first-time org packages — go to the package settings and make it public)
