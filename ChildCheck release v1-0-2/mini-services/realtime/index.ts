/**
 * ChildCheck realtime mini-service.
 *
 * Listens on port 3003. Frontend clients connect via `io("/?XTransformPort=3003")`
 * (relative path + XTransformPort query — never `io("http://localhost:3003")`)
 * so Caddy can forward to the right port.
 *
 * Rooms (joined by clients):
 *   - `room:<roomId>`   — live updates for a single room's roster
 *   - `program:<programId>` — live updates for an entire program
 *   - `class:<classId>` — live updates for a single class
 *
 * Events emitted to rooms:
 *   - `checkin:update`   — payload: { checkInRecordId, childPersonId, roomId, classId, programId, familyId }
 *   - `checkout:update`  — payload: { checkInRecordId, childPersonId, roomId, classId, programId, familyId }
 *   - `headcount:update` — payload: { roomId, classId, checkInSessionId, count, expected, discrepancy }
 *
 * Internal broadcast endpoint (called by Next.js API routes after a mutation):
 *   POST /broadcast
 *     Header: X-Internal-Key: <shared secret>  (env REALTIME_INTERNAL_KEY, default "childcheck-internal-dev")
 *     Body: { event: "checkin:update" | "checkout:update" | "headcount:update",
 *             rooms: string[],                    // e.g. ["room:abc","program:xyz","class:def"]
 *             payload: unknown }
 *
 *   Returns 200 { ok: true, emitted: <number of rooms> } on success.
 *   Returns 401 on missing/bad key, 400 on bad body.
 *
 * Health check: GET /health → 200 { ok: true, connections: <n>, rooms: <n> }.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server, type Socket } from "socket.io";

const PORT = 3003;
const INTERNAL_KEY = process.env.REALTIME_INTERNAL_KEY ?? "childcheck-internal-dev";

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Route: GET /health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        connections: io.engine.clientsCount,
        rooms: countRooms(),
      }),
    );
    return;
  }

  // Route: POST /broadcast
  if (req.method === "POST" && req.url === "/broadcast") {
    // Auth check.
    const key = req.headers["x-internal-key"];
    if (key !== INTERNAL_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // Read body.
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    let body: { event?: string; rooms?: string[]; payload?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }

    const event = body.event;
    const rooms = Array.isArray(body.rooms) ? body.rooms.filter((r) => typeof r === "string") : [];
    const payload = body.payload ?? null;
    if (!event || typeof event !== "string" || rooms.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "event and rooms[] required" }));
      return;
    }

    let emitted = 0;
    for (const room of rooms) {
      io.to(room).emit(event, payload);
      emitted++;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, emitted }));
    return;
  }

  // Default 404.
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const io = new Server(httpServer, {
  // Use the socket.io default path `/socket.io/` so the plain HTTP
  // /broadcast and /health endpoints on the SAME port aren't intercepted
  // by engine.io. (When `path: "/"` is used, engine.io intercepts EVERY
  // URL because they all start with `/`, breaking /broadcast.)
  //
  // Caddy forwards any request carrying `?XTransformPort=3003` to this
  // port — including the engine.io polling/websocket requests at
  // `/socket.io/?...&XTransformPort=3003`, so the default path works fine
  // through the gateway.
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

function countRooms(): number {
  // Exclude the per-socket auto-rooms (id === socket.id).
  let n = 0;
  for (const r of io.sockets.adapter.rooms.keys()) {
    if (!io.sockets.sockets.has(r)) n++;
  }
  return n;
}

io.on("connection", (socket: Socket) => {
  // Clients send `join` with a room name (or array of room names) immediately
  // after connect. We allow joining multiple rooms.
  socket.on("join", (data: unknown) => {
    if (typeof data === "string") {
      socket.join(data);
      return;
    }
    if (Array.isArray(data)) {
      for (const r of data) {
        if (typeof r === "string") socket.join(r);
      }
    }
  });

  socket.on("leave", (data: unknown) => {
    if (typeof data === "string") socket.leave(data);
  });

  // Lightweight heartbeat — clients can ping to verify the connection.
  socket.on("ping", () => socket.emit("pong", { t: Date.now() }));

  socket.on("error", (err: unknown) => {
    console.error(`[realtime] socket error ${socket.id}:`, err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] listening on port ${PORT}`);
});

// Graceful shutdown.
function shutdown() {
  console.log("[realtime] shutting down...");
  io.close();
  httpServer.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
