# proxyhub

Local Express reverse proxy for SAP BTP (SimpleMDG) development. Forwards requests from `localhost:3000`/`localhost:3001` to a remote SAP host, using session headers (cookies + CSRF token) captured from a browser extension.

## Architecture

```
 Browser frontend ──▶ localhost:3000 ──▶ Express proxy ──▶ SAP BTP upstream
                          │                    ▲
                          │                    │ /__config
 Browser extension ───────┘                    │ (headers, svUrl)
 (captures session on real site, POSTs here)
```

- `src/app.ts` — proxy entrypoint (Express)
- `extension/` — browser extension that auto-captures session headers (see `extension/README.md`)

## Run

```bash
npm install
npm run dev     # tsc --watch + both ports 3000 and 3001
# or individually:
npm run main    # port 3000
npm run admin   # port 3001
```

TypeScript compiles to `gen/srv/`.

## Configuration

The proxy is reconfigured at runtime via `POST /__config` (JSON body `{ headers, svUrl }`). The browser extension calls this endpoint automatically — no file edits required.

### `.env`

| Variable | Purpose |
| --- | --- |
| `ALLOWED_SV_HOSTS` | Comma-separated allowlist of upstream hostnames for `svUrl`. Exact or suffix match. Leave unset to allow any `https://` host. |

Example:

```
ALLOWED_SV_HOSTS=cfapps.br10.hana.ondemand.com,hana.ondemand.com
```

## Request flow

1. GET/POST/etc. hits `localhost:3000/<path>`.
2. If `/__config` has not been posted yet → `503 Proxy not configured`.
3. Image requests (`*.png`/`jpg`/`gif`/`webp`, `/image`, `/image(…)`) are streamed.
4. All other requests are forwarded to `${SV_URL}${req.originalUrl}` with `baseHeaders` (cookie, CSRF token, etc.) plus an allowlist of client headers (`content-type`, `accept`, `accept-language`, `if-match`, `if-none-match`, `prefer`).
5. On a write that lacks a CSRF token, or on a `403` with `x-csrf-token: required|rejected|invalid`, the proxy runs a `fetch`-token probe against `${SV_URL}/`, updates `baseHeaders`, and retries once.

## Security

`POST /__config` accepts only requests that satisfy *all* of:

- `Content-Type: application/json` — forces a CORS preflight which the server does not answer, blocking cross-site form-style CSRF.
- `Origin` is a browser-extension scheme (`chrome-extension:`, `moz-extension:`, `safari-web-extension:`, `ms-browser-extension:`) or `localhost`/`127.0.0.1`, or absent with `Sec-Fetch-Site: none|same-origin`.
- `svUrl` parses as a URL with `https:` (or `http:` only for localhost) and, if `ALLOWED_SV_HOSTS` is set, its hostname matches the allowlist. Only `url.origin` is stored.
- `headers` is a non-array object.

Requests that fail these checks are rejected with `415`/`403`/`400` and never mutate server state.

## Troubleshooting

- **No requests arrive / everything 503s**: the extension hasn't reached `/__config`. Open the extension's service-worker console and look for `[ProxyHub] ✓ Auto-configured` vs error. Common causes: extension throttled for 10 min (click force-recapture in the popup), or hostname not in `ALLOWED_SV_HOSTS`.
- **`SV_URL` is `""`** on `GET /__config`: same as above.
- **Upstream returns 403 on every write**: the CSRF probe is failing — check the upstream cookie is still valid by reloading the real site.

See `extension/README.md` for the browser extension setup.
