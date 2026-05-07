import express, { Application, NextFunction, Request, Response } from "express";
import axios, { AxiosRequestConfig, AxiosResponse, ResponseType } from "axios";
import config from "dotenv";
import * as _ from "lodash";
import chalk from "chalk";

config.config({ override: false });

const app: Application = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.text({ limit: "50mb", type: "text/plain" }));

const ALLOWED_SV_PROTOCOLS = new Set(["https:", "http:"]);
const ALLOWED_SV_HOSTS = (process.env.ALLOWED_SV_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isLocalhost = (h: string) => h === "localhost" || h === "127.0.0.1";

function parseAllowedSvUrl(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!ALLOWED_SV_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol === "http:" && !isLocalhost(url.hostname)) return null;
  if (ALLOWED_SV_HOSTS.length > 0) {
    const host = url.hostname;
    const ok = ALLOWED_SV_HOSTS.some(
      (allowed) => host === allowed || host.endsWith("." + allowed),
    );
    if (!ok) return null;
  }
  return url.origin;
}

const EXTENSION_ORIGIN_SCHEMES = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-web-extension:",
  "ms-browser-extension:",
]);

function isAllowedConfigOrigin(req: Request): boolean {
  const origin = req.headers["origin"] as string | undefined;
  if (origin) {
    try {
      const u = new URL(origin);
      if (EXTENSION_ORIGIN_SCHEMES.has(u.protocol)) return true;
      return isLocalhost(u.hostname);
    } catch {
      return false;
    }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "none" && site !== "same-origin") return false;
  return true;
}

const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_FAILURE_TOKENS = new Set(["required", "rejected", "invalid"]);
const HOP_BY_HOP = [
  "transfer-encoding",
  "connection",
  "content-length",
  "content-encoding",
  "cache-control",
  "expires",
  "pragma",
  "etag",
  "last-modified",
];

const NO_CACHE_HEADERS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  "pragma": "no-cache",
  "expires": "0",
  "surrogate-control": "no-store",
};
const STRIPPED_EXTENSION_HEADERS = ["host", "content-length", "origin"];
const FORWARD_PASSTHROUGH_HEADERS = [
  "content-type",
  "accept",
  "accept-language",
  "if-match",
  "prefer",
];

let baseHeaders: Record<string, string> | null = null;
let SV_URL: string = "";

let csrfRefreshInFlight: Promise<string | null> | null = null;

function refreshCsrfToken(): Promise<string | null> {
  if (csrfRefreshInFlight) return csrfRefreshInFlight;
  csrfRefreshInFlight = (async () => {
    if (!baseHeaders || !SV_URL) return null;
    try {
      const resp = await axios.request({
        method: "GET",
        url: `${SV_URL}/`,
        headers: { ...baseHeaders, "x-csrf-token": "fetch" },
        validateStatus: () => true,
        maxRedirects: 0,
      });
      const token = resp.headers["x-csrf-token"] as string | undefined;
      const setCookie = resp.headers["set-cookie"];
      if (Array.isArray(setCookie) && setCookie.length) {
        baseHeaders["cookie"] = mergeCookies(baseHeaders["cookie"] || "", setCookie);
      }
      if (token) {
        baseHeaders["x-csrf-token"] = token;
        console.log(chalk.green("[CSRF] refreshed token:"), chalk.yellow(token));
        return token;
      }
      console.log(chalk.yellow("[CSRF] probe returned no token, status"), resp.status);
      return null;
    } catch (err: any) {
      console.log(chalk.red("[CSRF] refresh failed:"), err?.message);
      return null;
    }
  })().finally(() => {
    csrfRefreshInFlight = null;
  });
  return csrfRefreshInFlight;
}

function mergeCookies(existing: string, setCookie: string[]): string {
  const jar: Record<string, string> = {};
  const add = (s: string) => {
    const idx = s.indexOf("=");
    if (idx < 0) return;
    const k = s.slice(0, idx).trim();
    const v = s.slice(idx + 1).trim();
    if (k) jar[k] = v;
  };
  for (const pair of existing.split(";")) add(pair);
  for (const sc of setCookie) add(sc.split(";")[0]);
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function isCsrfFailure(status: number, respHeaders: any): boolean {
  if (status !== 403) return false;
  const token = String(respHeaders?.["x-csrf-token"] || "").toLowerCase();
  return CSRF_FAILURE_TOKENS.has(token);
}

function buildForwardHeaders(clientReq: Request): Record<string, string> {
  const h = { ...(baseHeaders as Record<string, string>) };
  for (const name of FORWARD_PASSTHROUGH_HEADERS) {
    const v = clientReq.headers[name];
    if (v) h[name] = Array.isArray(v) ? v[0] : (v as string);
  }
  h["cache-control"] = "no-cache, no-store, max-age=0";
  h["pragma"] = "no-cache";
  delete h["if-none-match"];
  delete h["if-modified-since"];
  return h;
}

async function forwardRequest(
  req: Request,
  headers: Record<string, string>,
  responseType?: ResponseType,
): Promise<AxiosResponse> {
  const cfg: AxiosRequestConfig = {
    method: req.method,
    url: `${SV_URL}${req.originalUrl}`,
    data: req.body,
    headers,
    validateStatus: () => true,
  };
  if (responseType) cfg.responseType = responseType;
  return axios.request(cfg);
}

const IMAGE_RE = /(\/image(\(|$))|\.(png|jpe?g|gif|webp)$/i;

console.log(chalk.yellow("Waiting for extension to send headers via POST /__config"));

app.post("/__config", (req: Request, res: Response) => {
  const ct = (req.headers["content-type"] || "").toString().toLowerCase();
  if (!ct.startsWith("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json." });
  }
  if (!isAllowedConfigOrigin(req)) {
    return res.status(403).json({ error: "Forbidden origin." });
  }

  const { headers: newHeaders, svUrl } = req.body || {};

  if (!newHeaders || typeof newHeaders !== "object" || Array.isArray(newHeaders)) {
    return res.status(400).json({ error: "Missing headers in JSON body." });
  }
  const origin = parseAllowedSvUrl(svUrl);
  if (!origin) {
    return res.status(400).json({ error: "Invalid or disallowed svUrl." });
  }

  const lowered = _.mapKeys(newHeaders, (_v, k) => k.toLowerCase());
  baseHeaders = _.omit(lowered, STRIPPED_EXTENSION_HEADERS) as Record<string, string>;
  SV_URL = origin;
  console.log(
    chalk.green("Headers loaded from extension."),
    chalk.cyanBright.bold("SV_URL:"),
    chalk.underline.blueBright(SV_URL),
  );
  return res.json({ ok: true, SV_URL });
});

app.get("/__config", (_req: Request, res: Response) => {
  return res.json({ SV_URL, hasHeaders: !!baseHeaders });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!baseHeaders || !SV_URL) {
    return res.status(503).json({
      error: "Proxy not configured. POST headers to /__config (use the browser extension).",
    });
  }
  next();
});

app.use("/*", async (req: Request, res: Response) => {
  const isImage = IMAGE_RE.test(req.path);
  const method = (req.method || "GET").toUpperCase();
  const isWrite = !SAFE_METHODS.has(method);
  const label = isImage ? "[Proxy Image]" : "[Proxy]";

  try {
    console.log(
      chalk.magenta(label),
      chalk.cyan(`${method} ${SV_URL}${req.originalUrl}`),
    );

    if (isWrite && !baseHeaders!["x-csrf-token"]) {
      await refreshCsrfToken();
    }

    let response = await forwardRequest(
      req,
      buildForwardHeaders(req),
      isImage ? "stream" : undefined,
    );

    if (!isImage && isWrite && isCsrfFailure(response.status, response.headers)) {
      console.log(chalk.yellow("[CSRF] upstream rejected token, refreshing and retrying"));
      const fresh = await refreshCsrfToken();
      if (fresh) {
        response = await forwardRequest(req, buildForwardHeaders(req));
      }
    }

    res.set(_.omit(response.headers, HOP_BY_HOP));
    res.set(NO_CACHE_HEADERS);
    res.status(response.status ?? 200);

    if (isImage) {
      (response.data as NodeJS.ReadableStream).pipe(res);
      return;
    }

    let data = response.data;
    if (typeof data === "number") data = data.toString();
    return res.send(data);
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message =
      error?.response?.data || error?.message || "Internal Server Error";
    console.error(
      chalk.red(isImage ? "[Proxy Error Image]" : "[Proxy Error]"),
      chalk.yellow(status.toString()),
      message,
    );
    return res.status(status).send(message);
  }
});

app.listen(PORT, (): void => {
  console.log(chalk.green("SERVER IS UP ON PORT:"), chalk.yellow(PORT));
});
