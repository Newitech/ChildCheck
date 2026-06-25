// ChildCheck service worker — Stage 14 (PWA polish & offline).
//
// Capabilities:
//   - Precache the kiosk shell on install (/, /kiosk, /login, manifest, icons).
//   - Network-first navigations (cache fallback when offline).
//   - Cache-first for static same-origin assets.
//   - Runtime cache for GET /api/kiosk/search (stale-while-revalidate, TTL
//     60s) so recent family searches keep working offline.
//   - Offline write queue (IndexedDB `childcheck-offline-queue`) for
//     POST/PUT/DELETE to /api/kiosk/checkin and /api/kiosk/checkout.
//     When the network fails we store the request and return a synthetic
//     200 { ok: true, queued: true, queuedAt } so the kiosk UI shows a
//     "queued — will sync when reconnected" success state. The queue is
//     replayed on the `online` event and via a periodic retry.
//
// Skips /api/auth entirely (no caching, no queueing) — auth must always hit
// the network.
//
// Cache version: `childcheck-shell-v2`.

const SHELL_CACHE = "childcheck-shell-v2";
const SEARCH_CACHE = "childcheck-search-v2";
const SEARCH_TTL_MS = 60_000; // 60s — fresh enough for kiosk searches.

const SHELL_URLS = [
  "/",
  "/kiosk",
  "/login",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg",
];

const QUEUEABLE_METHODS = new Set(["POST", "PUT", "DELETE"]);
const QUEUEABLE_PATHS = new Set([
  "/api/kiosk/checkin",
  "/api/kiosk/checkout",
]);
const SEARCH_PATH = "/api/kiosk/search";
const AUTH_PREFIX = "/api/auth";

// ---------------------------------------------------------------------------
// IndexedDB queue helpers (tiny, no external dep).
// ---------------------------------------------------------------------------
const DB_NAME = "childcheck-offline-queue";
const DB_VERSION = 1;
const STORE = "requests";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(entry) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function queueAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function queueDelete(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueClear() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Message broadcasting to clients (so the UI can show sync progress).
// ---------------------------------------------------------------------------
async function broadcast(type, payload) {
  const clients = (await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  })) || [];
  for (const c of clients) {
    c.postMessage({ type, ...(payload || {}) });
  }
}

// ---------------------------------------------------------------------------
// Queue replay.
// ---------------------------------------------------------------------------
let replaying = false;

async function replayQueue() {
  if (replaying) return;
  replaying = true;
  try {
    const items = await queueAll();
    if (items.length === 0) {
      return;
    }
    await broadcast("queue:replaying", { count: items.length });
    let succeeded = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
          credentials: "include",
        });
        if (res.ok) {
          await queueDelete(item.id);
          succeeded += 1;
        } else {
          // 4xx is a permanent error — drop it to avoid infinite retry loops.
          // 5xx will be retried on the next online event.
          if (res.status >= 400 && res.status < 500) {
            await queueDelete(item.id);
            failed += 1;
            await broadcast("queue:item-failed", {
              id: item.id,
              status: res.status,
            });
          } else {
            failed += 1;
          }
        }
      } catch (err) {
        failed += 1;
        // Network failed again — stop replaying; will retry on next online.
        break;
      }
    }
    const remaining = await queueAll();
    if (remaining.length === 0) {
      await broadcast("queue:synced", { succeeded, failed });
    } else {
      await broadcast("queue:partial", {
        remaining: remaining.length,
        succeeded,
        failed,
      });
    }
  } finally {
    replaying = false;
  }
}

// ---------------------------------------------------------------------------
// Install: precache the shell.
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll is atomic — fall back to individual adds so a single 404
      // (e.g. /login in dev) doesn't nuke the whole precache.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

// ---------------------------------------------------------------------------
// Activate: clean up old caches.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== SEARCH_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // In case we have a leftover queue from a previous SW version.
      await broadcast("queue:ready", {});
    })(),
  );
});

// ---------------------------------------------------------------------------
// Helper: is this a queueable write request?
// ---------------------------------------------------------------------------
function isQueueable(url, method) {
  if (!QUEUEABLE_METHODS.has(method)) return false;
  return QUEUEABLE_PATHS.has(url.pathname);
}

function isAuth(url) {
  return url.pathname.startsWith(AUTH_PREFIX);
}

// ---------------------------------------------------------------------------
// Fetch handler.
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin.
  if (url.origin !== self.location.origin) return;

  // Never intercept /api/auth — it must always go to the network.
  if (isAuth(url)) return;

  // ----- Offline write queue for kiosk check-in / check-out -----
  if (isQueueable(url, req.method)) {
    event.respondWith(handleQueueableWrite(req));
    return;
  }

  // ----- GET requests -----
  if (req.method !== "GET") return;

  // ----- Runtime cache for kiosk search (SWR with TTL) -----
  if (url.pathname === SEARCH_PATH) {
    event.respondWith(handleSearchRequest(req));
    return;
  }

  // ----- Navigations: network-first, cache fallback -----
  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  // ----- Static assets: cache-first -----
  event.respondWith(handleAsset(req));
});

async function handleQueueableWrite(req) {
  // Always try the network first. Only queue if the network fails.
  try {
    return await fetch(req.clone());
  } catch (err) {
    // Network failed → queue it.
    try {
      const cloned = req.clone();
      const bodyText = await cloned.text();
      const headers = {};
      cloned.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const queuedAt = new Date().toISOString();
      await queueAdd({
        url: req.url,
        method: req.method,
        headers,
        body: bodyText || null,
        queuedAt,
      });
      await broadcast("queue:added", { queuedAt });
      // Schedule a replay attempt (in case the network comes back quickly).
      setTimeout(() => {
        void replayQueue();
      }, 1000);
      return new Response(
        JSON.stringify({ ok: true, queued: true, queuedAt }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (queueErr) {
      // IndexedDB failed too — surface a 503.
      return new Response(
        JSON.stringify({
          ok: false,
          error: "offline_queue_failed",
          message: "Network is down and the offline queue is unavailable.",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}

async function handleSearchRequest(req) {
  const cache = await caches.open(SEARCH_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      // Only cache OK responses.
      if (res && res.ok) {
        const copy = res.clone();
        // Stash a timestamp header by wrapping in a new Response.
        const stamped = new Response(copy.body, {
          status: copy.status,
          statusText: copy.statusText,
          headers: copy.headers,
        });
        stamped.headers.set("x-cached-at", Date.now().toString());
        cache.put(req, stamped).catch(() => undefined);
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    // SWR: return cache immediately, refresh in background.
    // Check TTL — if stale, still serve but force a refresh.
    const cachedAtStr = cached.headers.get("x-cached-at");
    const cachedAt = cachedAtStr ? Number(cachedAtStr) : 0;
    const ageMs = Date.now() - cachedAt;
    if (ageMs > SEARCH_TTL_MS) {
      // Stale — refresh in background.
      void networkPromise;
    }
    return cached;
  }

  const networkRes = await networkPromise;
  if (networkRes) return networkRes;

  // Nothing cached and network failed → return an empty result so the
  // kiosk UI doesn't crash. The user will see "no results" + offline banner.
  return new Response(JSON.stringify({ items: [], offline: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleNavigation(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    const copy = res.clone();
    cache.put(req, copy).catch(() => undefined);
    return res;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Fallback to the cached root for navigations.
    const root = await cache.match("/");
    if (root) return root;
    return new Response(
      "<html><body><h1>Offline</h1><p>This page isn't cached. Reconnect to load it.</p></body></html>",
      { status: 503, headers: { "Content-Type": "text/html" } },
    );
  }
}

async function handleAsset(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      cache.put(req, copy).catch(() => undefined);
    }
    return res;
  } catch (err) {
    // Last-ditch: serve from any cache entry that matches.
    const any = await caches.match(req);
    if (any) return any;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Message handler — clients can ask the SW to flush the queue or report.
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "queue:flush") {
    void replayQueue();
  } else if (data.type === "queue:count") {
    queueAll()
      .then((items) => {
        if (event.source) {
          event.source.postMessage({
            type: "queue:count:response",
            count: items.length,
          });
        }
      })
      .catch(() => undefined);
  } else if (data.type === "queue:clear") {
    queueClear()
      .then(() => broadcast("queue:synced", { succeeded: 0, failed: 0 }))
      .catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Online/offline events → trigger replay.
// ---------------------------------------------------------------------------
self.addEventListener("online", () => {
  void replayQueue();
});

// Periodic retry every 30s — covers cases where the `online` event doesn't
// fire reliably (it sometimes doesn't on mobile).
setInterval(() => {
  if (navigator.onLine) {
    void replayQueue();
  }
}, 30_000);
