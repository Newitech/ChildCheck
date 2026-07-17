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
 *   4. Start the realtime mini-service (Socket.io on port 3003) in the background.
 *   5. Start the Next.js standalone server in the foreground.
 *
 * Subcommands:
 *   childcheck              Start all services (db:push + realtime + next).
 *   childcheck realtime     Start only the realtime mini-service.
 *   childcheck server       Start only the Next.js server.
 *   childcheck db-push      Run prisma db:push and exit.
 *   childcheck version      Print version + exit.
 *
 * The launcher also detects file-path arguments (e.g. `childcheck /path/to/file.js`)
 * and runs them in-process — this is how the orchestrator spawns the Next.js
 * server and realtime service as child processes.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const VERSION = "1.0.0";

// `process.execPath` is the binary itself, so its dirname is the install dir.
const APP_DIR = path.dirname(process.execPath);

// Resolve a path relative to the app directory.
function app(p: string): string {
  return path.resolve(APP_DIR, p);
}

function log(msg: string) {
  console.log(`[childcheck] ${msg}`);
}

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

const PORT = process.env.PORT || "3000";
const REALTIME_PORT = process.env.REALTIME_PORT || "3003";
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || `file:${app("db/custom.db")}`;

// --------------------------------------------------------------------------
// Setup
// --------------------------------------------------------------------------

function ensureDirs() {
  const dirs = [app("data"), app("db"), app("config")];
  for (const d of dirs) {
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o750);
    }
  }
}

function loadDotenv() {
  const envFile = app(path.join("config", ".env"));
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function ensureNextAuthSecret() {
  if (process.env.NEXTAUTH_SECRET) return;
  const secretFile = app(path.join("config", ".nextauth-secret"));
  let secret: string;
  if (existsSync(secretFile)) {
    secret = readFileSync(secretFile, "utf8").trim();
  } else {
    secret = randomBytes(32).toString("hex");
    writeFileSync(secretFile, secret, { mode: 0o600 });
    chmodSync(secretFile, 0o600);
  }
  process.env.NEXTAUTH_SECRET = secret;
  log(`NEXTAUTH_SECRET ${existsSync(secretFile) ? "loaded" : "generated"} from ${secretFile}`);
}

// --------------------------------------------------------------------------
// Process spawning
// --------------------------------------------------------------------------

function spawnInherit(args: string[], opts: { cwd?: string } = {}): ChildProcess {
  return spawn(process.execPath, args, {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
    cwd: opts.cwd ?? APP_DIR,
  });
}

function runDbPush(): Promise<number> {
  return new Promise((resolve) => {
    const prismaCli = app(path.join("node_modules", "prisma", "build", "index.js"));
    if (!existsSync(prismaCli)) {
      log(`WARNING: prisma CLI not found at ${prismaCli} — skipping db:push`);
      resolve(0);
      return;
    }
    log("running prisma db:push...");
    const child = spawnInherit([prismaCli, "db", "push", "--schema", app("prisma/schema.prisma")], {
      cwd: APP_DIR,
    });
    child.on("exit", (code) => {
      log(`db:push exited with code ${code ?? 0}`);
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      log(`db:push failed to start: ${err.message}`);
      resolve(1);
    });
  });
}

function startRealtime(): ChildProcess {
  const entry = app(path.join("mini-services", "realtime", "index.ts"));
  log(`starting realtime mini-service on port ${REALTIME_PORT}...`);
  const child = spawnInherit([entry]);
  child.on("exit", (code) => {
    log(`realtime exited with code ${code ?? 0}`);
  });
  return child;
}

function startNextServer(): ChildProcess {
  const server = app("server.js");
  process.env.PORT = PORT;
  process.env.HOSTNAME = HOSTNAME;
  log(`starting Next.js server on ${HOSTNAME}:${PORT}...`);
  const child = spawnInherit([server]);
  return child;
}

// --------------------------------------------------------------------------
// Subcommands
// --------------------------------------------------------------------------

function cmdRealtimeOnly() {
  ensureDirs();
  loadDotenv();
  ensureNextAuthSecret();
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.REALTIME_PORT = REALTIME_PORT;
  const child = startRealtime();
  const shutdown = (sig: string) => {
    log(`received ${sig}, shutting down realtime...`);
    child.kill(sig as NodeJS.Signals);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

function cmdServerOnly() {
  ensureDirs();
  loadDotenv();
  ensureNextAuthSecret();
  process.env.DATABASE_URL = DATABASE_URL;
  const child = startNextServer();
  const shutdown = (sig: string) => {
    log(`received ${sig}, shutting down Next.js server...`);
    child.kill(sig as NodeJS.Signals);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  child.on("exit", (code) => process.exit(code ?? 0));
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

  // 2. realtime (background child process)
  const realtime = startRealtime();

  // 3. next server (foreground child process)
  const server = startNextServer();

  // Propagate signals to BOTH children.
  const shutdown = (sig: string) => {
    log(`received ${sig}, shutting down...`);
    try { realtime.kill(sig as NodeJS.Signals); } catch { /* ignore */ }
    try { server.kill(sig as NodeJS.Signals); } catch { /* ignore */ }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // If either dies, take the other down too.
  realtime.on("exit", (code) => {
    log(`realtime exited (code ${code ?? 0})`);
  });
  server.on("exit", (code) => {
    log(`Next.js server exited (code ${code ?? 0})`);
    try { realtime.kill("SIGTERM"); } catch { /* ignore */ }
    process.exit(code ?? 0);
  });
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

const KNOWN_COMMANDS = new Set([
  "start", "all", "realtime", "server", "next",
  "db-push", "dbpush", "version", "help",
  "--version", "-v", "--help", "-h",
  undefined,
]);

(async function main() {
  const cmd = process.argv[2];

  // If the argument is NOT a known subcommand but IS a file that exists,
  // run it in-process. This is how the orchestrator spawns server.js,
  // realtime/index.ts, and the prisma CLI — the compiled binary detects
  // the file path and executes it with Bun's runtime, which resolves
  // node_modules from the file's directory (correct module resolution).
  if (cmd && !KNOWN_COMMANDS.has(cmd) && existsSync(cmd)) {
    try {
      // Change to the file's directory so module resolution finds node_modules.
      process.chdir(path.dirname(path.resolve(cmd)));
      await import(path.resolve(cmd));
    } catch (err) {
      console.error(`Error running ${cmd}: ${err}`);
      process.exit(1);
    }
    return;
  }

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
  CHILDCHECK_DATA_KEY     AES-256 key for photo/backup encryption
  CHILDCHECK_DATA_DIR     Directory for photos + backups (default ./data)
  CHILDCHECK_CONFIG_DIR   Directory for persisted config (default ./config)
`);
      process.exit(0);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(`Run \`childcheck help\` for usage.`);
      process.exit(1);
  }
})();
