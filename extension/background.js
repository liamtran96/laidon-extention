const api = typeof browser !== "undefined" ? browser : chrome;

// Chromium (Chrome, Edge) needs `extraHeaders` to expose Cookie/Authorization
// headers; Firefox rejects the value. Edge defines `browser` as an alias to
// `chrome`, so we can't use the presence of `browser` to detect Firefox —
// only Firefox exposes `runtime.getBrowserInfo`.
const isFirefox =
  typeof browser !== "undefined" &&
  browser.runtime &&
  typeof browser.runtime.getBrowserInfo === "function";
const extraInfo = ["requestHeaders"];
if (!isFirefox) extraInfo.push("extraHeaders");

// Chrome MV3 kills the service worker after ~30s idle and is unreliable about
// waking it for webRequest events. A short-period alarm keeps it warm.
if (api.alarms) {
  api.alarms.create("keepAlive", { periodInMinutes: 0.4 });
  api.alarms.onAlarm.addListener(() => {});
}

// Track each tab's top-level URL. SAP UI5 (and other apps) set
// Referrer-Policy: no-referrer on fetches, so the request's Referer header is
// empty — but we still need to know which page made the request so we can
// match a mapping's pathPrefix.
const tabUrls = {};
if (api.webNavigation) {
  api.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId === 0) tabUrls[d.tabId] = d.url;
  });
}
if (api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => {
    delete tabUrls[tabId];
  });
}

let cachedMappings = [];
let sortedMappings = [];

const lastSent = {};
const lastSentSig = {};
const THROTTLE_MS = 10 * 60 * 1000;

function headerSignature(headers) {
  return (
    (headers["cookie"] || "") +
    "|" + (headers["x-csrf-token"] || "") +
    "|" + (headers["authorization"] || "")
  );
}

function updateMappings(next) {
  cachedMappings = next || [];
  // More specific mappings (with pathPrefix) must be checked before catch-alls.
  sortedMappings = [...cachedMappings].sort(
    (a, b) => (b.pathPrefix ? 1 : 0) - (a.pathPrefix ? 1 : 0),
  );
  const valid = new Set(cachedMappings.map((m) => m.key || m.domain));
  for (const k of Object.keys(lastSent)) {
    if (!valid.has(k)) {
      delete lastSent[k];
      delete lastSentSig[k];
    }
  }
}

api.storage.local.get(["mappings"], ({ mappings = [] }) => {
  updateMappings(mappings);
});
api.storage.onChanged.addListener((changes) => {
  if (changes.mappings) updateMappings(changes.mappings.newValue);
});

// Returns true and reserves the throttle slot if we should send. A changed
// signature (new cookie or CSRF token) bypasses the time window so the proxy
// gets fresh headers immediately.
function reserveSend(domain, sig) {
  const now = Date.now();
  const stale = !lastSent[domain] || now - lastSent[domain] > THROTTLE_MS;
  const changed = lastSentSig[domain] !== sig;
  if (!stale && !changed) return false;
  lastSent[domain] = now;
  lastSentSig[domain] = sig;
  return { changed };
}

function resetThrottle(domain) {
  delete lastSent[domain];
  delete lastSentSig[domain];
}

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === "force_recapture" && msg.key) {
    resetThrottle(msg.key);
    console.log(`[ProxyHub] Force recapture enabled for ${msg.key}`);
  }
});

const CAPTURABLE_TYPES = new Set(["xmlhttprequest", "other", "ping"]);

api.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!CAPTURABLE_TYPES.has(details.type)) return;

    let reqUrl;
    try {
      reqUrl = new URL(details.url);
    } catch {
      return;
    }

    const headers = {};
    for (const h of details.requestHeaders || []) {
      headers[h.name.toLowerCase()] = h.value;
    }
    const referer = headers["referer"] || "";
    // Fall back to the tab's top-level URL when Referer is suppressed by policy.
    const pageUrl = referer || tabUrls[details.tabId] || "";

    // Path prefix is matched against the page URL (the page that made the request),
    // not the request URL itself — API calls go to /sap/odata/... not /admin/...
    const mapping = sortedMappings.find((m) => {
      const domainMatch =
        reqUrl.hostname === m.domain || reqUrl.hostname.endsWith("." + m.domain);
      if (!domainMatch) return false;
      if (m.pathPrefix) return pageUrl.includes(m.domain + m.pathPrefix);
      return true;
    });
    if (!mapping) return;

    const mappingKey = mapping.key || mapping.domain;
    console.log("[ProxyHub] matched →", mappingKey, "port", mapping.port);

    // Check auth headers BEFORE consuming the throttle window — a request without
    // cookies would otherwise block valid requests for the next 10 minutes.
    if (!headers["cookie"] && !headers["authorization"]) {
      console.log("[ProxyHub] no cookie/auth header, skipping");
      return;
    }

    const reservation = reserveSend(mappingKey, headerSignature(headers));
    if (!reservation) {
      console.log("[ProxyHub] throttled, skipping", mappingKey);
      return;
    }

    fetch(`http://localhost:${mapping.port}/__config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers, svUrl: reqUrl.origin }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          console.log(`[ProxyHub] ✓ Auto-configured port ${mapping.port} for ${mappingKey}${reservation.changed ? " (headers changed)" : ""}`);
        } else {
          console.log("[ProxyHub] proxy responded with error:", data);
        }
      })
      .catch((err) => {
        console.log("[ProxyHub] fetch to localhost failed:", err.message);
        resetThrottle(mappingKey);
      });
  },
  { urls: ["<all_urls>"] },
  extraInfo
);
