const DEFAULT_MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 20;
const DEFAULT_DEDUP_WINDOW_MS = 60_000;
const DEFAULT_DAILY_CONVERSION_LIMIT = 3;
const DEFAULT_QUOTA_RESERVATION_TTL_MS = 10 * 60_000;
const DEFAULT_QUOTA_TIMEZONE = "Asia/Jakarta";
const rateLimitStore = new Map();

export default {
  async fetch(request, env, ctx) {
    let clientAddress = "unknown";
    let quotaReservationKey = "";
    let quotaReserved = false;

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return jsonResponse({ ok: true, runtime: "cloudflare-workers" }, 200, request, env);
      }

      if (url.pathname !== "/api/convert/pdf-to-docx" && url.pathname !== "/api/quota") {
        return jsonResponse({ message: "Endpoint tidak ditemukan." }, 404, request, env);
      }

      const corsHeaders = buildCorsHeaders(request, env);
      if (!corsHeaders) {
        return jsonResponse({ message: "Origin tidak diizinkan." }, 403, request, env);
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      clientAddress = request.headers.get("CF-Connecting-IP") || "unknown";

      if (url.pathname === "/api/quota") {
        if (request.method !== "GET") {
          return withCors(
            new Response(JSON.stringify({ message: "Method tidak didukung." }), {
              status: 405,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }),
            corsHeaders,
          );
        }

        const quotaStatus = await getDailyQuotaStatus(env, clientAddress);
        return jsonResponse(quotaStatus, 200, request, env, quotaStatus);
      }

      if (request.method !== "POST") {
        return withCors(
          new Response(JSON.stringify({ message: "Method tidak didukung." }), {
            status: 405,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          }),
          corsHeaders,
        );
      }

      const apiKey = (env.CLOUDMERSIVE_API_KEY || "").trim();
      if (!apiKey) {
        return jsonResponse({ message: "CLOUDMERSIVE_API_KEY belum diatur di Worker." }, 500, request, env);
      }

      if (!isRequestAllowed(clientAddress, env)) {
        return jsonResponse({ message: "Terlalu banyak request. Coba lagi sebentar." }, 429, request, env);
      }

      const payload = await request.json();
      const fileName = sanitizeFileName(payload?.fileName);
      const fileDataBase64 = typeof payload?.fileDataBase64 === "string" ? payload.fileDataBase64.trim() : "";

      if (!fileName || !fileDataBase64) {
        return jsonResponse({ message: "fileName dan fileDataBase64 wajib diisi." }, 400, request, env);
      }

      const fileBuffer = base64ToUint8Array(fileDataBase64);
      if (!fileBuffer.byteLength) {
        return jsonResponse({ message: "Isi file PDF tidak valid." }, 400, request, env);
      }

      const maxFileSizeBytes = getNumberEnv(env.MAX_FILE_SIZE_BYTES, DEFAULT_MAX_FILE_SIZE_BYTES);
      if (fileBuffer.byteLength > maxFileSizeBytes) {
        return jsonResponse({ message: "Ukuran file maksimal 3 MB. Pilih file PDF yang lebih kecil." }, 413, request, env);
      }

      const idempotencyKey = sanitizeIdempotencyKey(request.headers.get("X-Idempotency-Key"));
      const contentDedupKey = await createContentDedupKey(fileName, fileBuffer);
      const primaryDedupKey = `${clientAddress}:${contentDedupKey}`;
      const requestDedupKey = idempotencyKey ? `${clientAddress}:${idempotencyKey}` : "";

      const cachedResponse =
        (requestDedupKey ? await getCachedConversionResponse(requestDedupKey) : null) ||
        await getCachedConversionResponse(primaryDedupKey);
      if (cachedResponse) {
        const quotaStatus = await getDailyQuotaStatus(env, clientAddress);
        console.log("convert cache hit", JSON.stringify({
          source: "edge-cache",
          clientAddress,
          requestDedupKey: requestDedupKey || null,
          primaryDedupKey,
        }));
        cachedResponse.headers.set("X-Docswap-Dedup", "edge-cache");
        applyQuotaHeaders(cachedResponse.headers, quotaStatus);
        return withCors(cachedResponse, corsHeaders);
      }

      console.log("convert request accepted", JSON.stringify({
        clientAddress,
        requestDedupKey: requestDedupKey || null,
        primaryDedupKey,
        fileName,
        fileSize: fileBuffer.byteLength,
      }));

      quotaReservationKey = requestDedupKey || primaryDedupKey;
      let quotaStatus = await reserveDailyQuota(env, clientAddress, quotaReservationKey);
      if (!quotaStatus.allowed) {
        return jsonResponse(
          { message: "Token konversi harian sudah habis. Silakan coba lagi besok.", quota: quotaStatus },
          429,
          request,
          env,
          quotaStatus,
        );
      }

      quotaReserved = true;

      const conversionResponse = await getDurableConversionResponse(env, {
        dedupKey: primaryDedupKey,
        fileName,
        fileDataBase64,
      });

      if (!conversionResponse.ok) {
        if (quotaReserved) {
          quotaStatus = await releaseDailyQuota(env, clientAddress, quotaReservationKey);
        }
        const errorText = await conversionResponse.text();
        const errorResponse = new Response(errorText, {
          status: conversionResponse.status,
          statusText: conversionResponse.statusText,
          headers: {
            "Content-Type": conversionResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
          },
        });
        applyQuotaHeaders(errorResponse.headers, quotaStatus);
        return withCors(errorResponse, corsHeaders);
      }

      if (quotaReserved) {
        quotaStatus = await confirmDailyQuota(env, clientAddress, quotaReservationKey);
      }

      const conversionHeaders = new Headers(conversionResponse.headers);
      const conversionBuffer = await conversionResponse.arrayBuffer();

      const responseHeaders = new Headers(corsHeaders);
      responseHeaders.set("Content-Type", conversionHeaders.get("Content-Type") || "application/octet-stream");
      responseHeaders.set(
        "Content-Disposition",
        conversionHeaders.get("Content-Disposition") || `attachment; filename="${fileName.replace(/\.pdf$/i, ".docx")}"`,
      );
      responseHeaders.set("X-Docswap-Dedup", conversionHeaders.get("X-Docswap-Dedup") || "miss");
      applyQuotaHeaders(responseHeaders, quotaStatus);

      const response = new Response(conversionBuffer.slice(0), {
        status: 200,
        headers: responseHeaders,
      });
      ctx.waitUntil(cacheConversionVariants(response.clone(), env, primaryDedupKey, requestDedupKey));
      return response;
    } catch (error) {
      console.error("Cloudflare Worker convert error:", error);

      if (quotaReserved && quotaReservationKey) {
        try {
          await releaseDailyQuota(env, clientAddress, quotaReservationKey);
        } catch (releaseError) {
          console.error("Cloudflare Worker quota release error:", releaseError);
        }
      }

      return jsonResponse({ message: "Terjadi kesalahan pada backend convert." }, 500, request, env);
    }
  },
};

export class ConversionLock {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pendingConversion = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/convert") {
      return new Response(JSON.stringify({ message: "Method tidak didukung." }), {
        status: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    const payload = await request.json();
    const dedupKey = typeof payload?.dedupKey === "string" ? payload.dedupKey.trim() : "";
    const fileName = sanitizeFileName(payload?.fileName);
    const fileDataBase64 = typeof payload?.fileDataBase64 === "string" ? payload.fileDataBase64.trim() : "";

    if (!dedupKey || !fileName || !fileDataBase64) {
      return new Response(JSON.stringify({ message: "Payload dedupe tidak lengkap." }), {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    const storedResult = await this.getStoredResult();
    if (storedResult) {
      console.log("convert durable hit", JSON.stringify({
        source: "durable-cache",
        dedupKey,
        fileName,
      }));
      return buildConversionResponse(storedResult, "durable-cache");
    }

    if (!this.pendingConversion) {
      console.log("convert durable miss", JSON.stringify({
        source: "durable-lock-create",
        dedupKey,
        fileName,
      }));
      this.pendingConversion = this.createAndStoreResult(fileName, fileDataBase64)
        .finally(() => {
          this.pendingConversion = null;
        });
    } else {
      console.log("convert durable wait", JSON.stringify({
        source: "durable-lock-wait",
        dedupKey,
        fileName,
      }));
    }

    const result = await this.pendingConversion;
    if (!result.ok) {
      return new Response(JSON.stringify({ message: result.message || "Cloudmersive mengembalikan error." }), {
        status: result.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    return buildConversionResponse(result, "durable-lock");
  }

  async getStoredResult() {
    // Large conversion payloads can exceed Durable Object SQLite value limits.
    // We rely on the in-memory lock for concurrent requests and Cache API for
    // short-lived repeat requests after the first response is returned.
    return null;
  }

  async createAndStoreResult(fileName, fileDataBase64) {
    const apiKey = (this.env.CLOUDMERSIVE_API_KEY || "").trim();
    const fileBuffer = base64ToUint8Array(fileDataBase64);
    const conversionResult = await convertViaCloudmersive(apiKey, fileName, fileBuffer);

    if (!conversionResult.ok) {
      return conversionResult;
    }

    const storedResult = {
      ok: true,
      status: 200,
      createdAt: Date.now(),
      fileName,
      buffer: conversionResult.buffer.slice(0),
      contentType: conversionResult.contentType,
      contentDisposition: conversionResult.contentDisposition || `attachment; filename="${fileName.replace(/\.pdf$/i, ".docx")}"`,
    };

    return storedResult;
  }
}

export class DailyQuota {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const limit = getNumberEnv(this.env.DAILY_CONVERSION_LIMIT, DEFAULT_DAILY_CONVERSION_LIMIT);
    const reservationTtlMs = getNumberEnv(this.env.QUOTA_RESERVATION_TTL_MS, DEFAULT_QUOTA_RESERVATION_TTL_MS);
    const quotaState = await this.getQuotaState();
    pruneQuotaReservations(quotaState, Date.now(), reservationTtlMs);

    if (request.method === "GET" && url.pathname === "/status") {
      await this.persistQuotaState(quotaState);
      return this.buildJsonResponse(buildQuotaSnapshot(quotaState, limit, this.env));
    }

    if (request.method !== "POST") {
      return this.buildJsonResponse({ message: "Method tidak didukung." }, 405);
    }

    const payload = await request.json();
    const reservationKey = sanitizeQuotaReservationKey(payload?.reservationKey);
    if (!reservationKey) {
      return this.buildJsonResponse({ message: "reservationKey wajib diisi." }, 400);
    }

    if (url.pathname === "/reserve") {
      const existingReservation = quotaState.reservations[reservationKey];
      if (existingReservation) {
        existingReservation.createdAt = Date.now();
        await this.persistQuotaState(quotaState);
        return this.buildJsonResponse({ allowed: true, ...buildQuotaSnapshot(quotaState, limit, this.env) });
      }

      const consumedSlots = quotaState.used + getActiveReservationCount(quotaState);
      if (consumedSlots >= limit) {
        return this.buildJsonResponse({ allowed: false, ...buildQuotaSnapshot(quotaState, limit, this.env) }, 429);
      }

      quotaState.reservations[reservationKey] = { createdAt: Date.now() };
      await this.persistQuotaState(quotaState);
      return this.buildJsonResponse({ allowed: true, ...buildQuotaSnapshot(quotaState, limit, this.env) });
    }

    if (url.pathname === "/confirm") {
      if (quotaState.reservations[reservationKey]) {
        delete quotaState.reservations[reservationKey];
        quotaState.used += 1;
        await this.persistQuotaState(quotaState);
      }

      return this.buildJsonResponse({ allowed: true, ...buildQuotaSnapshot(quotaState, limit, this.env) });
    }

    if (url.pathname === "/release") {
      if (quotaState.reservations[reservationKey]) {
        delete quotaState.reservations[reservationKey];
        await this.persistQuotaState(quotaState);
      }

      return this.buildJsonResponse({ allowed: true, ...buildQuotaSnapshot(quotaState, limit, this.env) });
    }

    return this.buildJsonResponse({ message: "Endpoint quota tidak ditemukan." }, 404);
  }

  async getQuotaState() {
    const storedState = await this.state.storage.get("quotaState");
    return {
      used: Math.max(Number(storedState?.used) || 0, 0),
      reservations: sanitizeQuotaReservations(storedState?.reservations),
    };
  }

  async persistQuotaState(quotaState) {
    await this.state.storage.put("quotaState", quotaState);
  }

  buildJsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
}

function jsonResponse(body, status, request, env, quotaStatus = null) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  applyQuotaHeaders(response.headers, quotaStatus);
  const corsHeaders = buildCorsHeaders(request, env);
  return corsHeaders ? withCors(response, corsHeaders) : response;
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders.entries()) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS || "");

  const headers = new Headers();
  const allowAnyOrigin = allowedOrigins.size === 0 || allowedOrigins.has("*");

  if (origin) {
    if (!allowAnyOrigin && !allowedOrigins.has(origin)) {
      return null;
    }

    headers.set("Access-Control-Allow-Origin", allowAnyOrigin ? "*" : origin);
    if (!allowAnyOrigin) {
      headers.set("Vary", "Origin");
    }
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Disposition, Content-Type, Content-Length, X-Docswap-Dedup, X-Docswap-Daily-Limit, X-Docswap-Daily-Used, X-Docswap-Daily-Pending, X-Docswap-Daily-Remaining, X-Docswap-Daily-Date, X-Docswap-Daily-Reset-At",
  );
  return headers;
}

function parseAllowedOrigins(rawOrigins) {
  return new Set(
    String(rawOrigins)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function sanitizeFileName(fileName) {
  if (typeof fileName !== "string") {
    return "";
  }

  const normalized = fileName.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  if (!normalized) {
    return "";
  }

  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`;
}

function parseCloudmersiveError(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    if (typeof parsed.Message === "string") {
      return parsed.Message;
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    return errorText || "";
  }

  return "";
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

async function createContentDedupKey(fileName, fileBuffer) {
  const fingerprintSource = new Uint8Array(
    fileName.length + 1 + fileBuffer.byteLength,
  );
  let offset = 0;

  offset = appendAscii(fingerprintSource, offset, fileName);
  fingerprintSource[offset] = 0;
  offset += 1;
  fingerprintSource.set(fileBuffer, offset);

  const digest = await crypto.subtle.digest("SHA-256", fingerprintSource);
  return toHex(new Uint8Array(digest));
}

async function createQuotaObjectName(clientAddress, quotaDate) {
  return hashText(`${quotaDate}:${clientAddress}`);
}

async function hashText(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(new Uint8Array(digest));
}

async function getCachedConversionResponse(dedupKey) {
  const cache = caches.default;
  const cacheKey = createCacheRequest(dedupKey);
  const cachedResponse = await cache.match(cacheKey);

  if (!cachedResponse) {
    return null;
  }

  return new Response(await cachedResponse.arrayBuffer(), {
    status: cachedResponse.status,
    statusText: cachedResponse.statusText,
    headers: cachedResponse.headers,
  });
}

async function cacheConversionResponse(dedupKey, response, env) {
  const cache = caches.default;
  const cacheKey = createCacheRequest(dedupKey);
  const headers = new Headers(response.headers);
  const dedupWindowMs = getNumberEnv(env.DEDUP_WINDOW_MS, DEFAULT_DEDUP_WINDOW_MS);
  headers.set("Cache-Control", `public, max-age=${Math.max(Math.floor(dedupWindowMs / 1000), 1)}`);

  const cacheableResponse = new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(cacheKey, cacheableResponse);
}

async function cacheConversionVariants(response, env, ...dedupKeys) {
  const uniqueKeys = Array.from(new Set(dedupKeys.filter(Boolean)));
  if (uniqueKeys.length === 0) {
    return;
  }

  const responseBuffer = await response.arrayBuffer();
  await Promise.all(
    uniqueKeys.map((dedupKey) =>
      cacheConversionResponse(
        dedupKey,
        new Response(responseBuffer.slice(0), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        env,
      ),
    ),
  );
}

function createCacheRequest(dedupKey) {
  return new Request(`https://docswap-cache.internal/${encodeURIComponent(dedupKey)}`);
}

async function getDurableConversionResponse(env, payload) {
  const lockId = env.CONVERSION_LOCK.idFromName(payload.dedupKey);
  const lockStub = env.CONVERSION_LOCK.get(lockId);
  return lockStub.fetch("https://conversion-lock.internal/convert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
}

async function getDailyQuotaStatus(env, clientAddress) {
  return sendQuotaRequest(env, clientAddress, "/status", "GET");
}

async function reserveDailyQuota(env, clientAddress, reservationKey) {
  return sendQuotaRequest(env, clientAddress, "/reserve", "POST", { reservationKey });
}

async function confirmDailyQuota(env, clientAddress, reservationKey) {
  return sendQuotaRequest(env, clientAddress, "/confirm", "POST", { reservationKey });
}

async function releaseDailyQuota(env, clientAddress, reservationKey) {
  return sendQuotaRequest(env, clientAddress, "/release", "POST", { reservationKey });
}

async function sendQuotaRequest(env, clientAddress, pathname, method, body) {
  const quotaDate = getQuotaDateKey(env);
  const quotaId = env.DAILY_QUOTA.idFromName(await createQuotaObjectName(clientAddress, quotaDate));
  const quotaStub = env.DAILY_QUOTA.get(quotaId);
  const response = await quotaStub.fetch(`https://daily-quota.internal${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await response.json();

  return {
    allowed: response.ok,
    ...responseBody,
  };
}

async function convertViaCloudmersive(apiKey, fileName, fileBuffer) {
  console.log("cloudmersive upstream start", JSON.stringify({
    fileName,
    fileSize: fileBuffer.byteLength,
  }));

  const formData = new FormData();
  formData.append("inputFile", new File([fileBuffer], fileName, { type: "application/pdf" }));

  const upstreamResponse = await fetch("https://api.cloudmersive.com/convert/pdf/to/docx", {
    method: "POST",
    headers: {
      Apikey: apiKey,
    },
    body: formData,
  });

  const buffer = await upstreamResponse.arrayBuffer();
  if (!upstreamResponse.ok) {
    console.log("cloudmersive upstream error", JSON.stringify({
      fileName,
      status: upstreamResponse.status,
    }));
    const upstreamText = new TextDecoder().decode(buffer);
    return {
      ok: false,
      status: upstreamResponse.status,
      message: parseCloudmersiveError(upstreamText) || "Cloudmersive mengembalikan error.",
    };
  }

  console.log("cloudmersive upstream success", JSON.stringify({
    fileName,
    status: upstreamResponse.status,
  }));
  return {
    ok: true,
    status: 200,
    buffer,
    contentType: upstreamResponse.headers.get("content-type") || "application/octet-stream",
    contentDisposition: normalizeContentDisposition(
      upstreamResponse.headers.get("content-disposition"),
      fileName,
    ),
  };
}

function appendAscii(target, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index) & 0xff;
  }
  return offset + value.length;
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeIdempotencyKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 128);
}

function normalizeContentDisposition(contentDisposition, originalFileName) {
  const fallbackDisposition = `attachment; filename="${originalFileName.replace(/\.pdf$/i, ".docx")}"`;
  if (!contentDisposition) {
    return fallbackDisposition;
  }

  const parsedFileName = extractDispositionFileName(contentDisposition);
  if (!parsedFileName || isGenericConvertedFileName(parsedFileName)) {
    return fallbackDisposition;
  }

  return contentDisposition;
}

function extractDispositionFileName(contentDisposition) {
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return asciiMatch?.[1] || "";
}

function isGenericConvertedFileName(fileName) {
  const normalized = fileName.trim().toLowerCase();
  return normalized === "output.docx" || normalized === "converted.docx";
}

function getNumberEnv(value, fallbackValue) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

function getQuotaDateKey(env, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.DAILY_QUOTA_TIMEZONE || DEFAULT_QUOTA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getDateTimePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
  };
}

function getQuotaResetAt(dateKey, timeZone = DEFAULT_QUOTA_TIMEZONE) {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const targetUtcMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  let candidate = new Date(targetUtcMs);

  // Convert the next local midnight into its real UTC instant for the quota timezone.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getDateTimePartsInTimeZone(candidate, timeZone);
    const observedUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const deltaMs = observedUtcMs - targetUtcMs;

    if (deltaMs === 0) {
      return candidate.toISOString();
    }

    candidate = new Date(candidate.getTime() - deltaMs);
  }

  return candidate.toISOString();
}

function buildQuotaSnapshot(quotaState, limit, env) {
  const date = getQuotaDateKey(env);
  const pending = getActiveReservationCount(quotaState);
  const remaining = Math.max(limit - quotaState.used - pending, 0);

  return {
    date,
    limit,
    used: quotaState.used,
    pending,
    remaining,
    resetAt: getQuotaResetAt(date, env.DAILY_QUOTA_TIMEZONE || DEFAULT_QUOTA_TIMEZONE),
  };
}

function getActiveReservationCount(quotaState) {
  return Object.keys(quotaState.reservations).length;
}

function sanitizeQuotaReservations(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries = Object.entries(value)
    .filter(([reservationKey, reservation]) =>
      reservationKey &&
      typeof reservation === "object" &&
      Number.isFinite(reservation?.createdAt),
    )
    .map(([reservationKey, reservation]) => [
      reservationKey,
      { createdAt: Number(reservation.createdAt) },
    ]);

  return Object.fromEntries(entries);
}

function sanitizeQuotaReservationKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 256);
}

function pruneQuotaReservations(quotaState, now, reservationTtlMs) {
  for (const [reservationKey, reservation] of Object.entries(quotaState.reservations)) {
    if (!reservation || now - reservation.createdAt >= reservationTtlMs) {
      delete quotaState.reservations[reservationKey];
    }
  }
}

function applyQuotaHeaders(headers, quotaStatus) {
  if (!quotaStatus) {
    return;
  }

  headers.set("X-Docswap-Daily-Limit", String(quotaStatus.limit ?? DEFAULT_DAILY_CONVERSION_LIMIT));
  headers.set("X-Docswap-Daily-Used", String(quotaStatus.used ?? 0));
  headers.set("X-Docswap-Daily-Pending", String(quotaStatus.pending ?? 0));
  headers.set("X-Docswap-Daily-Remaining", String(quotaStatus.remaining ?? 0));
  if (quotaStatus.date) {
    headers.set("X-Docswap-Daily-Date", quotaStatus.date);
  }
  if (quotaStatus.resetAt) {
    headers.set("X-Docswap-Daily-Reset-At", quotaStatus.resetAt);
  }
}

function isRequestAllowed(clientAddress, env) {
  const now = Date.now();
  const rateLimitWindowMs = getNumberEnv(env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS);
  const maxRequestsPerWindow = getNumberEnv(env.MAX_REQUESTS_PER_WINDOW, DEFAULT_MAX_REQUESTS_PER_WINDOW);
  const currentEntry = rateLimitStore.get(clientAddress);

  if (!currentEntry || now - currentEntry.windowStart >= rateLimitWindowMs) {
    rateLimitStore.set(clientAddress, { count: 1, windowStart: now });
    pruneRateLimitStore(now, rateLimitWindowMs);
    return true;
  }

  if (currentEntry.count >= maxRequestsPerWindow) {
    return false;
  }

  currentEntry.count += 1;
  return true;
}

function pruneRateLimitStore(now, rateLimitWindowMs) {
  for (const [clientAddress, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= rateLimitWindowMs) {
      rateLimitStore.delete(clientAddress);
    }
  }
}

function buildConversionResponse(result, dedupHeader) {
  const headers = new Headers();
  headers.set("Content-Type", result.contentType || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    result.contentDisposition || `attachment; filename="${(result.fileName || "output.pdf").replace(/\.pdf$/i, ".docx")}"`,
  );
  headers.set("X-Docswap-Dedup", dedupHeader);

  return new Response(result.buffer.slice(0), {
    status: 200,
    headers,
  });
}
