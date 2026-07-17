/**
 * ChildCheck — launcher for the Bun-compiled standalone binary.
 *
 * This file is the entry point that `bun build --compile` turns into a single
 * self-contained `childcheck` executable (per-platform).
 *
 * Responsibilities:
 *   1. Ensure the data/ and db/ directories exist alongside the binary.
 *   2. Mint a default NEXTAUTH_SECRET if none is provided (persisted to
 *      ./config/.nextauth-secret so it stays stable across restarts).
 *   3. Run `prisma db push` to create / migrate the SQLite schema.
 *      Done by spawning the prisma CLI JS file via this same binary
 *      (Bun-compiled binaries can execute other JS files: `childcheck <file>`).
 *   4. Start the realtime mini-service (Socket.io on port 3003) in the background.
 *   5. Start the Next.js standalone server in the foreground.
 *
 * The launcher also responds to subcommands so the same binary can run the
 * individual pieces:
 *   childcheck                  → full orchestrator (default)
 *   childcheck realtime         → run only the realtime mini-service
 *   childcheck server           → run only the Next.js server
 *   childcheck db-push          → run prisma db push and exit
 *   childcheck version          → print version + exit
 *
 * File layout (after `scripts/build-binaries.sh` runs):
 *   childcheck-<platform>-<arch>/
 *     childcheck              ← the compiled binary (this file)
 *     server.js               ← Next.js standalone server
 *     .next/static/           ← static chunks
 *     public/                 ← static assets (manifest, icons, sw.js)
 *     prisma/
 *       schema.prisma
 *     node_modules/           ← prisma CLI + realtime deps (socket.io)
 *     mini-services/realtime/
 *       index.ts
 *     .env                    ← optional env file (created by install scripts)
 *     data/                   ← runtime: photos, branding, backups
 *     db/                     ← runtime: SQLite database
 *     config/                 ← runtime: persisted secrets
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const VERSION = "1.0.0";

// The directory the binary lives in. For a Bun-compiled binary,
// `process.execPath` is the binary itself, so its dirname is the install dir.
const APP_DIR = path.dirname(process.execPath);

// Resolve a path relative to the app dir.
const app = (p: string) => path.join(APP_DIR, p);

const DATA_DIR = process.env.CHILDCHECK_DATA_DIR || app("data");
const DB_DIR = process.env.CHILDCHECK_DB_DIR || app("db");
const CONFIG_DIR = process.env.CHILDCHECK_CONFIG_DIR || app("config");
const DATABASE_URL =
  process.env.DATABASE_URL || `file:${path.join(DB_DIR, "custom.db")}`;

const REALTIME_PORT = process.env.REALTIME_PORT || "3003";
const PORT = process.env.PORT || "3000";
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[childcheck] ${msg}`);
}

function ensureDirs() {
  for (const dir of [
    DATA_DIR,
    path.join(DATA_DIR, "photos"),
    path.join(DATA_DIR, "branding"),
    path.join(DATA_DIR, "backups"),
    DB_DIR,
    CONFIG_DIR,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log(`created dir: ${dir}`);
    }
  }
}

function loadDotenv() {
  // Lightweight .env loader (no dep on dotenv). Reads KEY=VALUE lines.
  const envPath = app(".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function ensureNextAuthSecret() {
  if (process.env.NEXTAUTH_SECRET) return;
  const secretFile = path.join(CONFIG_DIR, ".nextauth-secret");
  if (existsSync(secretFile)) {
    process.env.NEXTAUTH_SECRET = readFileSync(secretFile, "utf8").trim();
    log(`NEXTAUTH_SECRET loaded from ${secretFile}`);
    return;
  }
  // Generate 32 random bytes as hex.
  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretFile, secret, { mode: 0o600 });
  chmodSync(secretFile, 0o600);
  process.env.NEXTAUTH_SECRET = secret;
  log(`NEXTAUTH_SECRET generated and saved to ${secretFile}`);
}

function spawnInherit(args: string[], opts: { cwd?: string } = {}): ChildProcess {
  return spawn(process.execPath, args, {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
    cwd: opts.cwd ?? APP_DIR,
  });
}

async function runDbPush(): Promise<number> {
  const prismaCli = app(path.join("node_modules", "prisma", "build", "index.js"));
  if (!existsSync(prismaCli)) {
    log(`WARNING: prisma CLI not found at ${prismaCli} — skipping db:push`);
    return 0;
  }
  log("running prisma db:push...");
  // Use the compiled binary's built-in Bun runtime to run the prisma CLI.
  // The binary supports running JS files via the --bun flag.
  try {
    const child = spawn(process.execPath, ["--bun", prismaCli, "db", "push", "--schema", app("prisma/schema.prisma")], {
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
      cwd: APP_DIR,
    });
    return new Promise((resolve) => {
      child.on("exit", (code) => {
        log(`db:push exited with code ${code ?? 0}`);
        resolve(code ?? 0);
      });
      child.on("error", (err) => {
        log(`db:push failed to start: ${err.message}`);
        resolve(1);
      });
    });
  } catch (err) {
    log(`db:push error: ${err}`);
    return 1;
  }
}

async function startRealtime(): Promise<void> {
  const entry = app(path.join("mini-services", "realtime", "index.ts"));
  if (!existsSync(entry)) {
    log(`WARNING: realtime service not found at ${entry} — skipping`);
    return;
  }
  log(`starting realtime mini-service on port ${REALTIME_PORT}...`);
  try {
    await import(entry);
    log("realtime service started.");
  } catch (err) {
    log(`realtime service failed to start: ${err}`);
  }
}

async function startNextServer(): Promise<void> {
  const server = app("server.js");
  if (!existsSync(server)) {
    log(`ERROR: server.js not found at ${server}`);
    process.exit(1);
  }
  // Pass port + hostname via env (Next.js standalone server.js reads these).
  process.env.PORT = PORT;
  process.env.HOSTNAME = HOSTNAME;
  log(`starting Next.js server on ${HOSTNAME}:${PORT}...`);
  try {
    await import(server);
  } catch (err) {
    log(`Next.js server failed to start: ${err}`);
    process.exit(1);
  }
}

// --------------------------------------------------------------------------
// Subcommands
// --------------------------------------------------------------------------

async function cmdRealtimeOnly() {
  ensureDirs();
  loadDotenv();
  ensureNextAuthSecret();
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.REALTIME_PORT = REALTIME_PORT;
  await startRealtime();
  // Keep process alive — the realtime service listens on the event loop.
  process.on("SIGTERM", () => { log("received SIGTERM, exiting"); process.exit(0); });
  process.on("SIGINT", () => { log("received SIGINT, exiting"); process.exit(0); });
}

async function cmdServerOnly() {
  ensureDirs();
  loadDotenv();
  ensureNextAuthSecret();
  process.env.DATABASE_URL = DATABASE_URL;
  await startNextServer();
  // Keep process alive — the Next.js server listens on the event loop.
  process.on("SIGTERM", () => { log("received SIGTERM, exiting"); process.exit(0); });
  process.on("SIGINT", () => { log("received SIGINT, exiting"); process.exit(0); });
}

async function cmdDbPushOnly() {
  ensureDirs();
  loadDotenv();
  process.env.DATABASE_URL = DATABASE_URL;
  const code = await runDbPush();
  process.exit(code);
}

function cmdVersion() {
  console.log(`ChildCheck ${VERSION} (${process.platform}/${process.arch})`);
  console.log(`Bun runtime ${Bun.version}`);
  process.exit(0);
}

async function cmdOrchestrator() {
  ensureDirs();
  loadDotenv();
  ensureNextAuthSecret();
  process.env.DATABASE_URL = DATABASE_URL;

  // 1. db:push
  const dbCode = await runDbPush();
  if (dbCode !== 0) {
    log(`WARNING: db:push exited non-zero (${dbCode}) — continuing anyway`);
  }

  // 2. realtime (in-process — runs on the same event loop)
  await startRealtime();

  // 3. next server (in-process — runs on the same event loop)
  await startNextServer();

  // Both servers are now listening on the same event loop.
  // Signal handling: just exit cleanly.
  const shutdown = (sig: string) => {
    log(`received ${sig}, shutting down...`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

(function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case undefined:
    case "start":
    case "all":
      cmdOrchestrator();
      break;
    case "realtime":
      cmdRealtimeOnly();
      break;
    case "server":
    case "next":
      cmdServerOnly();
      break;
    case "db-push":
    case "dbpush":
      cmdDbPushOnly();
      break;
    case "version":
    case "--version":
    case "-v":
      cmdVersion();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`ChildCheck ${VERSION}

Usage:
  childcheck              Start all services (db:push + realtime + next).
  childcheck realtime     Start only the realtime mini-service.
  childcheck server       Start only the Next.js server.
  childcheck db-push      Run prisma db:push and exit.
  childcheck version      Print version and exit.
  childcheck help         Show this help.

Environment variables (override in .env or shell):
  PORT                    Next.js port (default 3000)
  REALTIME_PORT           Socket.io port (default 3003)
  HOSTNAME                Bind address (default 0.0.0.0)
  DATABASE_URL            SQLite path (default file:./db/custom.db)
  NEXTAUTH_URL            Public URL (e.g. https://checkin.mychurch.org)
  NEXTAUTH_SECRET         Session JWT signing secret (auto-generated if unset)
  CHILDCHECK_DATA_DIR     Photos/backups/branding dir (default ./data)
  CHILDCHECK_DATA_KEY     32-byte hex AES key for photo/backup encryption
  REALTIME_INTERNAL_KEY   Shared secret for the /broadcast endpoint

Files alongside this binary:
  server.js               Next.js standalone server
  .next/static/           Next.js static chunks
  public/                 Manifest, icons, service worker
  prisma/schema.prisma    Database schema
  node_modules/           Prisma CLI + socket.io
  mini-services/realtime/ Socket.io mini-service source
  .env                    Optional env file
  data/                   Runtime photos / branding / backups
  db/                     SQLite database
  config/                 Persisted runtime secrets
`);
      process.exit(0);
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Run `childcheck help` for usage.");
      process.exit(2);
  }
})();
