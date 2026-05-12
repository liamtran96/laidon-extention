# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**proxyhub** — A local Express reverse proxy for SAP BTP (SimpleMDG) development. The proxy holds session headers (cookie + `x-csrf-token`) plus an upstream origin (`SV_URL`) in memory, then forwards every other request to that origin with those headers. Session state is injected at runtime by a Manifest V3 browser extension (`extension/`) that watches XHRs on configured domains and POSTs the captured headers to `/__config`.

Two ports (3000 + 3001) exist so a single host can serve two apps (e.g. `…/main` and `…/admin`) without their sessions colliding.

## Build & Run

- `npm install`
- `npm run build` — `tsc` compiles `src/` → `gen/srv/` (CommonJS, ES2019)
- `npm run dev` — runs both proxies together (tsc --watch + nodemon for 3000 + 3001)
- `npm run main` / `npm run admin` — single port (3000 / 3001) in watch mode
- `npm run start` is **not** defined; raw node runs need `PORT=… node gen/srv/app.js`

No tests exist. There is no linter.

### Environment

- `PORT` — set automatically by the npm scripts via `cross-env`; defaults to 3000.
- `ALLOWED_SV_HOSTS` — comma-separated allowlist of upstream hostnames the extension may register via `/__config` (suffix-matched, so `hana.ondemand.com` covers all subdomains). Empty/unset means "allow any host"; `http://` is always rejected for non-localhost.
- `.env` is loaded via `dotenv` (`override: false`).

## Architecture

### Proxy (`src/app.ts`)

Single-file Express app. The relevant pieces, in order:

1. **`/__config` (POST)** — the extension's contract. Validates `Content-Type: application/json`, checks `Origin` is an extension scheme or localhost (`isAllowedConfigOrigin`), validates the supplied `svUrl` through `parseAllowedSvUrl` (protocol + `ALLOWED_SV_HOSTS`), then stores `baseHeaders` (lowercased, with `host`/`content-length`/`origin` stripped) and `SV_URL` in module-level globals.
2. **`/__config` (GET)** — used by the extension popup for the green/red status dot; returns `{ SV_URL, hasHeaders }`.
3. **Gate middleware** — every non-`/__config` request returns 503 until headers have been received.
4. **Catch-all forwarder (`/*`)** — `forwardRequest` calls `axios.request` against `${SV_URL}${req.originalUrl}`. Images (matched by `IMAGE_RE`) are streamed with `responseType: "stream"`; everything else is buffered. Hop-by-hop and caching headers (`HOP_BY_HOP`) are stripped from the response and replaced with `NO_CACHE_HEADERS` to keep the browser from caching proxied responses.
5. **CSRF flow** — `refreshCsrfToken` does a single-flight `GET /` with `x-csrf-token: fetch` against the upstream and merges any `Set-Cookie` back into `baseHeaders["cookie"]` via `mergeCookies`. It runs (a) lazily before the first write when no token is cached, and (b) reactively when a 403 response carries `x-csrf-token: required|rejected|invalid`, after which the original write is retried once.

`src/config.ts` is a scratch list of commented-out upstream URLs — not imported anywhere.

### Browser extension (`extension/`)

Manifest V3 service worker that replaces the old "paste a fetch snippet into the source" workflow.

- `manifest.json` / `manifest.firefox.json` — separate manifests because Firefox rejects `extraHeaders` on `webRequest`.
- `background.js` — service worker. Maintains a user-edited list of mappings (`{domain, pathPrefix, port, key}`) in `storage.local`. On every `webRequest.onSendHeaders`, picks the most-specific matching mapping (mappings with a `pathPrefix` sort first), and if the request carries a `Cookie` or `Authorization` header, POSTs the headers + origin to `http://localhost:{port}/__config`.
  - Capture is throttled per mapping (`THROTTLE_MS` = 10 min), but a changed header signature (cookie / csrf / authorization) bypasses the throttle so token rotation propagates immediately.
  - Chromium-only: an `alarms` keep-alive + `webNavigation.onCommitted` tab-URL cache exist because (a) MV3 kills idle service workers and (b) SAP UI5 sets `Referrer-Policy: no-referrer` so `pathPrefix` has to match against the top-level tab URL.
- `popup.html` / `popup.js` — mapping CRUD UI. Status dot polls `GET /__config` per mapped port. The `↺` button sends `force_recapture` to the service worker, which clears the throttle slot for that mapping.

### Header capture loop, end to end

1. Browser makes any authenticated XHR on a mapped domain.
2. Service worker sees it in `webRequest.onSendHeaders`, matches a mapping, and POSTs `{headers, svUrl}` to the local proxy on the mapping's port.
3. Proxy stores `baseHeaders` + `SV_URL` and starts serving requests.
4. Your local frontend points at `localhost:3000` / `localhost:3001`; the proxy forwards everything upstream with the captured session, refreshing CSRF on demand.

See `extension/README.md` for the user-facing install / mapping guide.
