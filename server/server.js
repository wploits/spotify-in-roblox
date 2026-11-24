const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8765);
const API_TOKEN = process.env.API_TOKEN || "";
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS || 10000);

let activeClient = null;
let lastKnownStatus = null;
const pendingRequests = new Map();
const artworkCache = new Map();

function isAllowedArtworkUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "i.scdn.co" ||
      host === "mosaic.scdn.co" ||
      host.endsWith(".spotifycdn.com") ||
      host.endsWith(".scdn.co")
    );
  } catch {
    return false;
  }
}

async function fetchArtworkBuffer(imageUrl) {
  if (!isAllowedArtworkUrl(imageUrl)) {
    throw new Error("Unsupported artwork URL");
  }
  if (artworkCache.has(imageUrl)) {
    return artworkCache.get(imageUrl);
  }
  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch artwork (${resp.status})`);
  }
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await resp.arrayBuffer());
  const entry = { buffer, contentType };
  if (artworkCache.size >= 30) {
    const firstKey = artworkCache.keys().next().value;
    artworkCache.delete(firstKey);
  }
  artworkCache.set(imageUrl, entry);
  return entry;
}

function sendCommand(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!activeClient || activeClient.readyState !== 1) {
      reject(new Error("Spotify (Spicetify extension) is not connected"));
      return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Command '${action}' timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });
    activeClient.send(JSON.stringify({ id, action, params }));
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(body);
}

function isAuthorized(req, url) {
  if (!API_TOKEN) return true;
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${API_TOKEN}`) return true;
  if (url.searchParams.get("token") === API_TOKEN) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (!isAuthorized(req, url)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    if (path === "/" || path === "/health") {
      sendJson(res, 200, {
        ok: true,
        spotifyConnected: Boolean(activeClient && activeClient.readyState === 1),
        lastKnownStatus,
        endpoints: [
          "GET /health",
          "GET /now-playing (or /status)",
          "GET /search?q=...&type=track&limit=10",
          "POST|GET /play (optional body/query: uri, query|q)",
          "POST|GET /pause (or /stop)",
          "POST|GET /toggle",
          "POST|GET /next",
          "POST|GET /prev",
          "POST|GET /seek (positionMs or seconds)",
          "POST|GET /volume (volume: 0..100)",
          "POST|GET /shuffle (state: true|false)",
          "POST|GET /repeat (mode: 0|1|2)",
          "POST|GET /like (liked: true|false)",
          "GET /queue",
          "POST|GET /queue/add (uri)",
          "GET /artwork (or /thumbnail, optional ?url=...)",
        ],
      });
      return;
    }

    if (path === "/artwork" || path === "/thumbnail") {
      let imageUrl = url.searchParams.get("url");
      if (!imageUrl) {
        if (activeClient && activeClient.readyState === 1) {
          const status = await sendCommand("now_playing");
          lastKnownStatus = status;
          imageUrl = status?.track?.imageUrl || null;
        } else {
          imageUrl = lastKnownStatus?.track?.imageUrl || null;
        }
      }
      if (!imageUrl) {
        sendJson(res, 404, { ok: false, error: "No artwork available" });
        return;
      }
      const { buffer, contentType } = await fetchArtworkBuffer(imageUrl);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(buffer);
      return;
    }

    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const queryParams = Object.fromEntries(url.searchParams.entries());
    const params = { ...queryParams, ...body };

    if (path === "/now-playing" || path === "/status") {
      const data = await sendCommand("now_playing");
      lastKnownStatus = data;
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/search") {
      const data = await sendCommand("search", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/play") {
      const data = await sendCommand("play", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/pause" || path === "/stop") {
      const data = await sendCommand("pause");
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/toggle") {
      const data = await sendCommand("toggle");
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/next") {
      const data = await sendCommand("next");
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/prev" || path === "/back") {
      const data = await sendCommand("prev");
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/seek") {
      const data = await sendCommand("seek", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/volume") {
      const data = await sendCommand("volume", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/shuffle") {
      if (typeof params.state === "string") {
        params.state = params.state === "true";
      }
      const data = await sendCommand("shuffle", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/repeat") {
      const data = await sendCommand("repeat", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/like") {
      if (typeof params.liked === "string") {
        params.liked = params.liked === "true";
      }
      const data = await sendCommand("like", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/queue" && req.method === "GET") {
      const data = await sendCommand("queue_get");
      sendJson(res, 200, { ok: true, data });
      return;
    }

    if (path === "/queue/add" || (path === "/queue" && req.method === "POST")) {
      const data = await sendCommand("queue_add", params);
      sendJson(res, 200, { ok: true, data });
      return;
    }

    sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
  } catch (err) {
    const status = err.message.includes("not connected") ? 503 : 400;
    sendJson(res, status, { ok: false, error: err.message });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[Bridge] Spicetify extension connected");
  if (activeClient && activeClient !== ws) {
    activeClient.close();
  }
  activeClient = ws;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (msg.type === "hello" || msg.type === "event") {
      lastKnownStatus = msg.status || lastKnownStatus;
      return;
    }

    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject, timer } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      clearTimeout(timer);
      if (msg.ok) {
        resolve(msg.data);
      } else {
        reject(new Error(msg.error || "Command failed"));
      }
    }
  });

  ws.on("close", () => {
    if (activeClient === ws) {
      activeClient = null;
      console.log("[Bridge] Spicetify extension disconnected");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Spotify HTTP Bridge listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint for Spicetify: ws://127.0.0.1:${PORT}/ws`);
  if (API_TOKEN) {
    console.log("API_TOKEN authentication is ENABLED");
  }
});
