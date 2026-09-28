'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const CLOUDMERSIVE_API_KEY = (process.env.CLOUDMERSIVE_API_KEY || '').trim();
const MAX_REQUESTS_PER_WINDOW = Number(process.env.MAX_REQUESTS_PER_WINDOW || 20);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_FILE_SIZE_BYTES || 3 * 1024 * 1024);
const DAILY_CONVERSION_LIMIT = Number(process.env.DAILY_CONVERSION_LIMIT || 3);
const QUOTA_RESERVATION_TTL_MS = Number(process.env.QUOTA_RESERVATION_TTL_MS || 10 * 60_000);
const DAILY_QUOTA_TIMEZONE = process.env.DAILY_QUOTA_TIMEZONE || 'Asia/Jakarta';
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const rateLimitStore = new Map();
const dailyQuotaStore = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (requestUrl.pathname !== '/api/convert/pdf-to-docx' && requestUrl.pathname !== '/api/quota') {
      return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
    }

    if (!applyCors(req, res)) {
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const clientAddress = getClientAddress(req);

    if (requestUrl.pathname === '/api/quota') {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { message: 'Method tidak didukung.' });
      }

      return sendJson(res, 200, getDailyQuotaStatus(clientAddress), getDailyQuotaStatus(clientAddress));
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { message: 'Method tidak didukung.' });
    }

    if (!CLOUDMERSIVE_API_KEY) {
      return sendJson(res, 500, { message: 'CLOUDMERSIVE_API_KEY belum diatur di backend.' });
    }

    if (!isRequestAllowed(clientAddress)) {
      return sendJson(res, 429, { message: 'Terlalu banyak request. Coba lagi sebentar.' });
    }

    const body = await readJsonBody(req);
    const fileName = sanitizeFileName(body.fileName);
    const fileDataBase64 = typeof body.fileDataBase64 === 'string' ? body.fileDataBase64.trim() : '';

    if (!fileName || !fileDataBase64) {
      return sendJson(res, 400, { message: 'fileName dan fileDataBase64 wajib diisi.' });
    }

    const fileBuffer = Buffer.from(fileDataBase64, 'base64');
    if (!fileBuffer.length) {
      return sendJson(res, 400, { message: 'Isi file PDF tidak valid.' });
    }

    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      return sendJson(res, 413, { message: 'Ukuran file maksimal 3 MB. Pilih file PDF yang lebih kecil.' });
    }

    const idempotencyKey = sanitizeIdempotencyKey(req.headers['x-idempotency-key']);
    const contentDedupKey = createContentDedupKey(fileName, fileBuffer);
    const primaryDedupKey = `${clientAddress}:${contentDedupKey}`;
    const requestDedupKey = idempotencyKey ? `${clientAddress}:${idempotencyKey}` : '';
    const quotaReservationKey = requestDedupKey || primaryDedupKey;
    let quotaStatus = reserveDailyQuota(clientAddress, quotaReservationKey);

    if (!quotaStatus.allowed) {
      return sendJson(
        res,
        429,
        { message: 'Token konversi harian sudah habis. Silakan coba lagi besok.', quota: quotaStatus },
        quotaStatus
      );
    }

    const formData = new FormData();
    formData.append('inputFile', new Blob([fileBuffer], { type: 'application/pdf' }), fileName);

    const cloudmersiveResponse = await fetch('https://api.cloudmersive.com/convert/pdf/to/docx', {
      method: 'POST',
      headers: {
        Apikey: CLOUDMERSIVE_API_KEY
      },
      body: formData
    });

    const responseBuffer = Buffer.from(await cloudmersiveResponse.arrayBuffer());
    const contentType = cloudmersiveResponse.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = normalizeContentDisposition(
      cloudmersiveResponse.headers.get('content-disposition'),
      fileName
    );

    if (!cloudmersiveResponse.ok) {
      const errorText = responseBuffer.toString('utf8');
      quotaStatus = releaseDailyQuota(clientAddress, quotaReservationKey);
      return sendJson(res, cloudmersiveResponse.status, {
        message: parseCloudmersiveError(errorText) || 'Cloudmersive mengembalikan error.'
      }, quotaStatus);
    }

    quotaStatus = confirmDailyQuota(clientAddress, quotaReservationKey);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(responseBuffer.length));
    res.setHeader('Content-Disposition', contentDisposition);
    applyQuotaHeaders(res, quotaStatus);
    res.writeHead(200);
    res.end(responseBuffer);
  } catch (error) {
    console.error('Proxy convert error:', error);
    sendJson(res, 500, { message: 'Terjadi kesalahan pada backend convert.' });
  }
});

server.listen(PORT, () => {
  console.log(`DocSwap backend berjalan di http://localhost:${PORT}`);
});

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowAnyOrigin = ALLOWED_ORIGINS.size === 0 || ALLOWED_ORIGINS.has('*');

  if (origin) {
    if (!allowAnyOrigin && !ALLOWED_ORIGINS.has(origin)) {
      sendJson(res, 403, { message: 'Origin tidak diizinkan.' });
      return false;
    }

    res.setHeader('Access-Control-Allow-Origin', allowAnyOrigin ? '*' : origin);
    if (!allowAnyOrigin) {
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Idempotency-Key');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Disposition, Content-Type, Content-Length, X-Docswap-Daily-Limit, X-Docswap-Daily-Used, X-Docswap-Daily-Pending, X-Docswap-Daily-Remaining, X-Docswap-Daily-Date, X-Docswap-Daily-Reset-At'
  );
  return true;
}

function sendJson(res, statusCode, body, quotaStatus = null) {
  const payload = JSON.stringify(body);
  applyQuotaHeaders(res, quotaStatus);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > MAX_FILE_SIZE_BYTES * 2) {
        reject(new Error('Payload terlalu besar. Ukuran file maksimal 3 MB.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function parseCloudmersiveError(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    if (typeof parsed.Message === 'string') {
      return parsed.Message;
    }
    if (typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    return errorText || '';
  }

  return '';
}

function sanitizeFileName(fileName) {
  if (typeof fileName !== 'string') {
    return '';
  }

  const normalized = fileName.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  if (!normalized.toLowerCase().endsWith('.pdf')) {
    return `${normalized}.pdf`;
  }
  return normalized;
}

function sanitizeIdempotencyKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 128);
}

function normalizeContentDisposition(contentDisposition, originalFileName) {
  const fallbackDisposition = `attachment; filename="${originalFileName.replace(/\.pdf$/i, '.docx')}"`;
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
  return asciiMatch?.[1] || '';
}

function isGenericConvertedFileName(fileName) {
  const normalized = fileName.trim().toLowerCase();
  return normalized === 'output.docx' || normalized === 'converted.docx';
}

function createContentDedupKey(fileName, fileBuffer) {
  return `${fileName}:${fileBuffer.byteLength}:${fileBuffer.subarray(0, 64).toString('base64')}`;
}

function getClientAddress(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function getQuotaDateKey(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_QUOTA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

function getDateTimePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value),
    second: Number(parts.find((part) => part.type === 'second')?.value)
  };
}

function getQuotaResetAt(dateKey, timeZone = DAILY_QUOTA_TIMEZONE) {
  const [year, month, day] = dateKey.split('-').map((value) => Number(value));
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

function getQuotaState(clientAddress) {
  const date = getQuotaDateKey();
  const quotaKey = `${date}:${clientAddress}`;
  const now = Date.now();
  let quotaState = dailyQuotaStore.get(quotaKey);

  if (!quotaState) {
    quotaState = { used: 0, reservations: {} };
    dailyQuotaStore.set(quotaKey, quotaState);
  }

  pruneDailyQuotaStore(now);
  pruneQuotaReservations(quotaState, now);
  return { quotaKey, quotaState, date };
}

function getDailyQuotaStatus(clientAddress) {
  const { quotaState, date } = getQuotaState(clientAddress);
  const pending = Object.keys(quotaState.reservations).length;
  return {
    date,
    limit: DAILY_CONVERSION_LIMIT,
    used: quotaState.used,
    pending,
    remaining: Math.max(DAILY_CONVERSION_LIMIT - quotaState.used - pending, 0),
    resetAt: getQuotaResetAt(date)
  };
}

function reserveDailyQuota(clientAddress, reservationKey) {
  const { quotaState } = getQuotaState(clientAddress);
  const now = Date.now();

  if (quotaState.reservations[reservationKey]) {
    quotaState.reservations[reservationKey].createdAt = now;
    return { allowed: true, ...getDailyQuotaStatus(clientAddress) };
  }

  const consumedSlots = quotaState.used + Object.keys(quotaState.reservations).length;
  if (consumedSlots >= DAILY_CONVERSION_LIMIT) {
    return { allowed: false, ...getDailyQuotaStatus(clientAddress) };
  }

  quotaState.reservations[reservationKey] = { createdAt: now };
  return { allowed: true, ...getDailyQuotaStatus(clientAddress) };
}

function confirmDailyQuota(clientAddress, reservationKey) {
  const { quotaState } = getQuotaState(clientAddress);

  if (quotaState.reservations[reservationKey]) {
    delete quotaState.reservations[reservationKey];
    quotaState.used += 1;
  }

  return { allowed: true, ...getDailyQuotaStatus(clientAddress) };
}

function releaseDailyQuota(clientAddress, reservationKey) {
  const { quotaState } = getQuotaState(clientAddress);

  if (quotaState.reservations[reservationKey]) {
    delete quotaState.reservations[reservationKey];
  }

  return { allowed: true, ...getDailyQuotaStatus(clientAddress) };
}

function pruneQuotaReservations(quotaState, now) {
  for (const [reservationKey, reservation] of Object.entries(quotaState.reservations)) {
    if (!reservation || now - reservation.createdAt >= QUOTA_RESERVATION_TTL_MS) {
      delete quotaState.reservations[reservationKey];
    }
  }
}

function pruneDailyQuotaStore(now) {
  for (const [quotaKey] of dailyQuotaStore.entries()) {
    const [date] = quotaKey.split(':');
    const resetAt = Date.parse(getQuotaResetAt(date));
    if (Number.isFinite(resetAt) && now >= resetAt + QUOTA_RESERVATION_TTL_MS) {
      dailyQuotaStore.delete(quotaKey);
    }
  }
}

function applyQuotaHeaders(res, quotaStatus) {
  if (!quotaStatus) {
    return;
  }

  res.setHeader('X-Docswap-Daily-Limit', String(quotaStatus.limit ?? DAILY_CONVERSION_LIMIT));
  res.setHeader('X-Docswap-Daily-Used', String(quotaStatus.used ?? 0));
  res.setHeader('X-Docswap-Daily-Pending', String(quotaStatus.pending ?? 0));
  res.setHeader('X-Docswap-Daily-Remaining', String(quotaStatus.remaining ?? 0));
  if (quotaStatus.date) {
    res.setHeader('X-Docswap-Daily-Date', quotaStatus.date);
  }
  if (quotaStatus.resetAt) {
    res.setHeader('X-Docswap-Daily-Reset-At', quotaStatus.resetAt);
  }
}

function isRequestAllowed(clientAddress) {
  const now = Date.now();
  const entry = rateLimitStore.get(clientAddress);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientAddress, { count: 1, windowStart: now });
    pruneRateLimitStore(now);
    return true;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  entry.count += 1;
  return true;
}

function pruneRateLimitStore(now) {
  for (const [address, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(address);
    }
  }
}
