const api = typeof browser !== "undefined" ? browser : chrome;

// Chrome needs extraHeaders to access cookies; Firefox rejects the value.
const extraInfo = ["requestHeaders"];
if (typeof browser === "undefined") extraInfo.push("extraHeaders");

let cachedMappings = [];
let sortedMappings = [];

function updateMappings(next) {
  cachedMappings = next || [];
  // More specific mappings (with pathPrefix) must be checked before catch-alls.
  sortedMappings = [...cachedMappings].sort(
    (a, b) => (b.pathPrefix ? 1 : 0) - (a.pathPrefix ? 1 : 0),
  );
  const valid = new Set(cachedMappings.map((m) => m.key || m.domain));
  for (const k of Object.keys(lastSent)) {
    if (!valid.has(k)) delete lastSent[k];
  }
}

api.storage.local.get(["mappings"], ({ mappings = [] }) => {
  updateMappings(mappings);
});
api.storage.onChanged.addListener((changes) => {
  if (changes.mappings) updateMappings(changes.mappings.newValue);
});

const lastSent = {};
const THROTTLE_MS = 10 * 60 * 1000;

function shouldSend(domain) {
  const now = Date.now();
  if (!lastSent[domain] || now - lastSent[domain] > THROTTLE_MS) {
    lastSent[domain] = now;
    return true;
  }
  return false;
}

function resetThrottle(domain) {
  delete lastSent[domain];
}

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === "force_recapture" && msg.key) {
    resetThrottle(msg.key);
    console.log(`[ProxyHub] Force recapture enabled for ${msg.key}`);
  }
});

api.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.type !== "xmlhttprequest") return;

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

    // Path prefix is matched against the Referer (the page that made the request),
    // not the request URL itself — API calls go to /sap/odata/... not /admin/...
    const mapping = sortedMappings.find((m) => {
      const domainMatch =
        reqUrl.hostname === m.domain || reqUrl.hostname.endsWith("." + m.domain);
      if (!domainMatch) return false;
      if (m.pathPrefix) return referer.includes(m.domain + m.pathPrefix);
      return true;
    });
    if (!mapping) return;

    const mappingKey = mapping.key || mapping.domain;
    console.log("[ProxyHub] matched →", mappingKey, "port", mapping.port);

    if (!shouldSend(mappingKey)) {
      console.log("[ProxyHub] throttled, skipping", mappingKey);
      return;
    }

    if (!headers["cookie"] && !headers["authorization"]) {
      console.log("[ProxyHub] no cookie/auth header, skipping");
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
          console.log(`[ProxyHub] ✓ Auto-configured port ${mapping.port} for ${mappingKey}`);
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
