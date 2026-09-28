# DocSwap Backend Proxy

Folder ini sekarang punya dua opsi backend:

- `server.js`: backend Node lokal untuk development cepat
- `worker.mjs`: backend Cloudflare Workers untuk deploy gratis jangka panjang

## Jalankan Lokal

1. Salin `functions/.env.example` menjadi `functions/.env`
2. Isi `CLOUDMERSIVE_API_KEY`
3. Jalankan:

```bash
cd functions
node server.js
```

Backend default berjalan di `http://localhost:8787`.

Endpoint status kuota harian tersedia di `GET /api/quota`.

## Deploy ke Cloudflare Workers

1. Login ke Cloudflare:

```bash
cd functions
npx wrangler login
```

2. Set secret API key:

```bash
npx wrangler secret put CLOUDMERSIVE_API_KEY
```

3. Jalankan lokal dengan runtime Workers:

```bash
npm run cf:dev
```

4. Deploy:

```bash
npm run cf:deploy
```

Setelah deploy, Anda akan mendapat URL Worker seperti:

```text
https://docswap-convert-proxy.<subdomain>.workers.dev
```

## Frontend

Frontend lokal sudah diarahkan ke `http://localhost:8787` lewat `src/environments/environment.ts`.

Untuk build production/mobile, isi `backendBaseUrl` di `src/environments/environment.prod.ts`
dengan URL Worker yang benar-benar sudah terdeploy.

## Catatan Keamanan

- API key tidak lagi dikirim ke client.
- Cloudflare Worker menyimpan API key sebagai `secret`, bukan di source code.
- Backend memakai allowlist origin sederhana lewat `ALLOWED_ORIGINS`.
- Limit 3 konversi per hari sekarang divalidasi di backend, bukan hanya di UI.
- Cloudflare Worker menyimpan kuota harian lewat Durable Object agar pembatasan tetap konsisten per hari.
- Ada rate limit ringan tambahan untuk lonjakan request. Ini cukup untuk proteksi dasar, tapi bukan pengganti proteksi edge yang lebih ketat.
- Untuk production serius, pertimbangkan menambah auth app atau token internal per request.
