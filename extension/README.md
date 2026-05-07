# ProxyHub Connector - Browser Extension

> Auto-captures session headers from SAP BTP (SimpleMDG) and sends them to your local proxy server. No more manual copy/paste of fetch requests.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   BEFORE (Manual)                    AFTER (With Extension)                 │
│   ──────────────────                 ─────────────────────────              │
│                                                                             │
│   1. Visit target URL                1. Visit target URL                    │
│   2. Open DevTools                   2. Make any XHR request (GET is fine)  │
│   3. Find request                    3. Done! Headers auto-captured         │
│   4. Copy as fetch                                                          │
│   5. Paste to proxy                                                         │
│   6. Restart proxy                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```
   ┌───────────────────────────────────────────────────────────────┐
   │                                                               │
   │   1. npm run dev            Start proxy (3000 + 3001)         │
   │                                                               │
   │   2. Load extension         chrome://extensions > Load unpacked│
   │                                                               │
   │   3. Add mapping            Click extension > Add domain/path │
   │                                                               │
   │   4. Visit target URL       Any XHR (GET or POST) triggers it │
   │                                                               │
   │   5. Run your repo          Point to localhost:3000 or 3001   │
   │                                                               │
   └───────────────────────────────────────────────────────────────┘
```

## Installation (Chrome/Edge)

```
┌─────────────────────────────────────────────────────────────┐
│  chrome://extensions                          [Developer mode ✓] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                        │
│  │ Load unpacked   │  <── Click this                        │
│  └─────────────────┘                                        │
│                                                             │
│  Select folder: extension/                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Done - you'll see "ProxyHub Connector" in your extensions

## Installation (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.firefox.json` from the `extension/` folder

> Note: Firefox temporary add-ons are removed when browser closes. For permanent install, use Firefox Developer Edition or submit to AMO.

## Setup

### 1. Start the proxy server

```bash
# Start both main (3000) + admin (3001) in one command
npm run dev
```

Or run individually:
```bash
npm run main   # Only port 3000
npm run admin  # Only port 3001
```

### 2. Add URL mappings in extension

Click the extension icon in browser toolbar:

```
┌──────────────────────────────────────┐
│  ProxyHub Connector       2 mappings │
├──────────────────────────────────────┤
│                                      │
│  ● butterball-dev-...com/main    ↺ ✕ │
│    → localhost:3000                  │
│                                      │
│  ● butterball-dev-...com/admin   ↺ ✕ │
│    → localhost:3001                  │
│                                      │
├──────────────────────────────────────┤
│  Domain / path                       │
│  ┌────────────────────────────────┐  │
│  │ my-app.hana.ondemand.com/main │  │
│  └────────────────────────────────┘  │
│                                      │
│  Proxy port                          │
│  ┌────────────────────────────────┐  │
│  │ 3000 (main)              ▼    │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │         Add mapping            │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘

● = Green (online) / Red (offline)
↺ = Force recapture
✕ = Delete mapping
```

**Steps:**
1. Enter any upstream URL — the hostname can be anything you want to proxy. The path's first segment (e.g. `/main`, `/admin`) is only used to tell two apps on the same host apart; it has no hard-coded meaning.
   - e.g. `my-app.hana.ondemand.com/main`
   - e.g. `my-app.hana.ondemand.com/admin`
2. Select the proxy port from the dropdown — this is what actually routes:
   - `3000` → `npm run main`
   - `3001` → `npm run admin`
3. Click **Add mapping**

**Example mappings:**

| URL | Port |
|-----|------|
| `butterball-dev-simplemdg-web.cfapps.us21.hana.ondemand.com/main` | 3000 |
| `butterball-dev-simplemdg-web.cfapps.us21.hana.ondemand.com/admin` | 3001 |
| `panasonic-sg-dev-simplemdg-web.cfapps.ap11.hana.ondemand.com/main` | 3000 |

### 3. Trigger header capture

1. Visit the target URL in your browser
2. Perform any action that makes an XHR request — a GET works too; the extension triggers on any `xmlhttprequest` that carries a session cookie
3. Extension auto-captures headers and sends to proxy
4. The popup dot turns green once the proxy responds; the `→ localhost:<port> · <svUrl>` line below the mapping confirms `/__config` actually received headers

## Usage

Once setup is complete:

1. Run your local repo pointing to `localhost:3000` or `localhost:3001`
2. All requests are proxied to the target SAP BTP server with captured session headers

## Status Indicators

| Dot | Meaning |
|-----|---------|
| Green | Proxy reachable on that port (may not yet have headers — check the `· <svUrl>` suffix) |
| Red | Proxy not running / unreachable |

## Buttons

| Button | Action |
|--------|--------|
| **Add mapping** | Register a new domain/path to capture |
| ↺ (recapture) | Force re-capture headers on next POST request |
| ✕ (delete) | Remove a mapping |

## Multiple Browser Profiles

Each browser profile is **completely isolated** — extensions and settings don't sync between profiles.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Profile A                         Profile B                   │
│   ─────────                         ─────────                   │
│   ┌─────────────────┐               ┌─────────────────┐         │
│   │ Extension ✓     │               │ Extension ✗     │         │
│   │ Mappings: 3     │               │ (not loaded)    │         │
│   └─────────────────┘               └─────────────────┘         │
│                                                                 │
│   Must load extension separately in each profile!               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Setup for each profile

| Step | Action |
|------|--------|
| 1 | Open the profile |
| 2 | Go to `chrome://extensions` |
| 3 | Enable Developer mode |
| 4 | Load unpacked → select same `extension/` folder |
| 5 | Add your URL mappings |

> **Note:** All profiles can share the same `extension/` folder, but each profile has its own mappings stored separately.

### What IS shared

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Profile A ─────┐                                              │
│                  │         ┌─────────────────────┐              │
│   Profile B ─────┼────────>│  localhost:3000     │  SHARED      │
│                  │         │  localhost:3001     │  (proxy)     │
│   Profile C ─────┘         └─────────────────────┘              │
│                                                                 │
│   The proxy server is shared — whichever profile sends          │
│   headers last, that's what the proxy uses.                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Headers not being captured?

- Make sure proxy server is running (`npm run main` or `npm run admin`)
- Check that your URL mapping matches the target domain + path
- Trigger any XHR on the target site (GET works too); the request must carry a session cookie or auth header
- Check browser console for `[ProxyHub]` log messages
- If the proxy logs `Invalid or disallowed svUrl`, the upstream hostname isn't in `ALLOWED_SV_HOSTS` (see the root `README.md` → Configuration)

### "Already mapped" error?

The domain + path combination already exists. Delete the old mapping first if you want to change the port.

## How it works

```
┌──────────────┐      POST request       ┌─────────────────┐
│    Browser   │ ───────────────────────>│   SAP BTP       │
│              │                         │   Server        │
└──────┬───────┘                         └─────────────────┘
       │                                          ^
       │ Extension captures                       │
       │ headers (cookie, csrf)                   │
       v                                          │
┌──────────────┐                         ┌────────┴────────┐
│   Extension  │ ─── POST /__config ───> │  Local Proxy    │
│  background  │     {headers, svUrl}    │  :3000 / :3001  │
└──────────────┘                         └────────┬────────┘
                                                  │
                                                  │ Forwards requests
                                                  │ with session headers
                                                  v
                                         ┌─────────────────┐
                                         │   Your Local    │
                                         │   App (repo)    │
                                         └─────────────────┘
```

**Flow:**
1. Extension listens to all outgoing XHR requests (any method) that carry a session cookie or auth header
2. When a request matches a mapped domain + path, it captures the headers (cookies, CSRF token, etc.)
3. Headers are sent to `localhost:{port}/__config`
4. Proxy server updates its session and forwards all requests to the target server

## Files

```
extension/
  manifest.json         # Chrome/Edge manifest (Manifest V3)
  manifest.firefox.json # Firefox manifest
  background.js         # Service worker - captures headers
  popup.html            # Extension popup UI
  popup.js              # Popup logic
```
