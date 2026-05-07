# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**proxyhub** — A local Express-based HTTP reverse proxy used for development. It forwards all requests to a remote SAP BTP (SimpleMDG) server, using session headers extracted from a browser `fetch()` snippet pasted into `src/app.ts`.

## Build & Run

- **Install:** `npm install`
- **Build:** `npm run build` (runs `tsc`, outputs to `gen/srv/`)
- **Dev (main):** `npm run main` — starts on port 3000 with watch mode (tsc --watch + nodemon)
- **Dev (admin):** `npm run admin` — starts on port 3001 with watch mode
- **Start (raw):** `npm run start` — requires `PORT` env var to be set

No tests are configured.

## Architecture

This is a single-file proxy server with two helpers:

- **`src/app.ts`** — Main entry point. Configures Express, parses a raw browser `fetch()` snippet to extract session headers (cookies, CSRF token), derives the upstream URL from the `Referer` header, then proxies all incoming requests to that URL. Image requests are streamed; other responses are buffered. Port is set via `PORT` env var.
- **`src/utils.ts`** — `extractHeadersFromAxiosCode()` parses a `fetch()`/axios code string and extracts the headers object from it (balanced-brace parser with JSON/JS eval fallback).
- **`src/config.ts`** — Contains a list of commented-out environment URLs for quick switching (not imported by app.ts currently).

### How to use

1. Copy a `fetch()` call from browser DevTools (right-click network request → Copy as fetch)
2. Paste the raw string into the `raw` template literal in `src/app.ts`
3. The proxy extracts headers and derives `SV_URL` from the `Referer` header
4. Point your local frontend to `localhost:3000` (or 3001) and requests are forwarded upstream with the captured session

### Key details

- TypeScript compiles to `gen/srv/` (CommonJS, ES2019 target)
- `.env` file is loaded via dotenv for the `PORT` variable
- Upstream response headers `transfer-encoding`, `connection`, `content-length` are stripped before forwarding to avoid content-length mismatches
