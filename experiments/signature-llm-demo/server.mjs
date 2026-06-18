import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, content, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  });
  response.end(content);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("baseUrl is required.");
  }

  const url = new URL(baseUrl.trim().replace(/\/$/, ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl must start with http:// or https://.");
  }

  return url.toString().replace(/\/$/, "");
}

async function proxyChatCompletions(request, response) {
  let payload;

  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch (error) {
    sendJson(response, 400, { error: { message: error.message || "Invalid JSON body." } });
    return;
  }

  try {
    const baseUrl = normalizeBaseUrl(payload.baseUrl);
    const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";

    if (!apiKey) {
      throw new Error("apiKey is required.");
    }

    if (!payload.requestBody || typeof payload.requestBody !== "object") {
      throw new Error("requestBody is required.");
    }

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload.requestBody),
    });
    const upstreamText = await upstreamResponse.text();
    const contentType =
      upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";

    response.writeHead(upstreamResponse.status, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(upstreamText);
  } catch (error) {
    sendJson(response, 400, { error: { message: error.message || "Proxy request failed." } });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPathname = pathname.replace(/^\/+/, "");

  if (normalizedPathname.includes("..")) {
    sendText(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  const filePath = join(ROOT, normalizedPathname);
  const extension = filePath.slice(filePath.lastIndexOf("."));

  try {
    const content = await readFile(filePath);
    sendText(response, 200, content, MIME_TYPES[extension] || "application/octet-stream");
  } catch {
    sendText(response, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  if (request.url?.startsWith("/api/chat-completions")) {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: { message: "Method not allowed." } });
      return;
    }

    await proxyChatCompletions(request, response);
    return;
  }

  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed", "text/plain; charset=utf-8");
    return;
  }

  await serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`Signature LLM demo proxy: http://localhost:${PORT}`);
});
