const api = typeof browser !== "undefined" ? browser : chrome;

const mappingList = document.getElementById("mappingList");
const countEl = document.getElementById("count");
const domainInput = document.getElementById("domainInput");
const portSelect = document.getElementById("portSelect");
const addBtn = document.getElementById("addBtn");
const toast = document.getElementById("toast");

let mappings = [];

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = "toast" + (isError ? " error" : "");
  setTimeout(() => (toast.textContent = ""), 2500);
}

async function checkProxyStatus(port) {
  try {
    const r = await fetch(`http://localhost:${port}/__config`, {
      signal: AbortSignal.timeout(1000),
    });
    const data = await r.json();
    return { online: true, svUrl: data.SV_URL || "", hasHeaders: data.hasHeaders };
  } catch {
    return { online: false, svUrl: "", hasHeaders: false };
  }
}

function getMappingKey(m) {
  return m.key || m.domain;
}

async function render() {
  mappingList.innerHTML = "";
  countEl.textContent = `${mappings.length} mapping${mappings.length !== 1 ? "s" : ""}`;

  if (mappings.length === 0) {
    mappingList.innerHTML = '<p class="empty">No mappings yet. Add one below.</p>';
    return;
  }

  const statuses = await Promise.all(mappings.map((m) => checkProxyStatus(m.port)));

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    const status = statuses[i];
    const key = getMappingKey(m);
    const label = m.originalUrl || key;

    const item = document.createElement("div");
    item.className = "mapping-item";

    const dot = document.createElement("span");
    dot.className = "dot" + (status.online ? " online" : " offline");
    dot.title = status.online
      ? `Connected — ${status.svUrl || "no URL yet"}`
      : "Proxy offline";

    const info = document.createElement("div");
    info.className = "mapping-info";

    const domain = document.createElement("div");
    domain.className = "mapping-domain";
    domain.textContent = label;
    domain.title = label;

    const portLabel = document.createElement("div");
    portLabel.className = "mapping-port";
    portLabel.textContent =
      `→ localhost:${m.port}` + (status.svUrl ? ` · ${status.svUrl}` : "");

    info.appendChild(domain);
    info.appendChild(portLabel);

    const recaptureBtn = document.createElement("button");
    recaptureBtn.className = "btn-icon recapture";
    recaptureBtn.title = "Force recapture on next request";
    recaptureBtn.textContent = "↺";
    recaptureBtn.addEventListener("click", () => {
      api.runtime.sendMessage({ type: "force_recapture", key });
      showToast(`Will recapture ${key} on next request`);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon delete";
    deleteBtn.title = "Remove mapping";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => {
      mappings = mappings.filter((x) => getMappingKey(x) !== key);
      api.storage.local.set({ mappings });
      render();
    });

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(recaptureBtn);
    item.appendChild(deleteBtn);
    mappingList.appendChild(item);
  }
}

function load() {
  api.storage.local.get(["mappings"], ({ mappings: saved = [] }) => {
    mappings = saved;
    render();
  });
}

addBtn.addEventListener("click", () => {
  const originalUrl = domainInput.value.trim();
  const input = originalUrl.replace(/^https?:\/\//, "");
  const [hostPart, ...pathParts] = input.split("/");
  const domain = hostPart;
  const pathPrefix = pathParts.length > 0 ? "/" + pathParts[0] : "";
  const mappingKey = domain + pathPrefix;
  const port = parseInt(portSelect.value, 10);

  if (!domain) {
    showToast("Enter a domain first", true);
    return;
  }
  if (mappings.find((m) => m.key === mappingKey)) {
    showToast("Already mapped", true);
    return;
  }

  mappings.push({ key: mappingKey, domain, pathPrefix, port, originalUrl });
  api.storage.local.set({ mappings });
  domainInput.value = "";
  showToast(`Added — visit ${mappingKey} to trigger capture`);
  render();
});

domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBtn.click();
});

load();
