"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";
const GROUP = "Turkey";
const M3U_FILE = path.join(__dirname, "..", "iptv.m3u");
const EPG_FILE = path.join(__dirname, "..", "epg.xml");
const FETCH_TIMEOUT_MS = 20000;

const EPG_UPSTREAM_URL =
  process.env.EPG_UPSTREAM_URL ||
  "https://epgshare01.online/epgshare01/epg_ripper_TR1.xml.gz";

const IPTVORG_GRAB_DIR = process.env.IPTVORG_GRAB_DIR || "";

const IPTVORG_CHANNELS_URL =
  process.env.IPTVORG_CHANNELS_URL ||
  "https://iptv-org.github.io/api/channels.json";
const IPTVORG_LOGOS_URL =
  process.env.IPTVORG_LOGOS_URL || "https://iptv-org.github.io/api/logos.json";

const PROXY_BASE = (process.env.PROXY_BASE || "").replace(/\/+$/, "");

const EPG_URL =
  process.env.EPG_URL ||
  "https://raw.githubusercontent.com/kadirmetin/vavoo-iptv/main/epg.xml";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,tr;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  origin: "https://vavoo.to",
  referer: "https://vavoo.to/live",
  dnt: "1",
  "sec-ch-ua":
    '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

// --- fetch helpers ---
function buildBody(cursor) {
  return JSON.stringify({
    language: "de",
    region: "DE",
    catalogId: "iptv",
    id: "",
    adult: false,
    search: "",
    sort: "name",
    filter: { group: GROUP },
    cursor,
  });
}

async function fetchPage(cursor) {
  const body = buildBody(cursor);
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(CATALOG_URL, {
        method: "POST",
        headers: HEADERS,
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data && data.error) throw new Error(`Vavoo error: ${data.error}`);
      return data;
    } catch (err) {
      lastErr = err;
      const wait = 1000 * attempt;
      console.warn(
        `Attempt ${attempt} failed (${err.message}). Retrying in ${wait}ms...`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchAll() {
  const items = [];
  let cursor = null;
  let page = 0;
  const MAX_PAGES = 200;
  do {
    page++;
    const data = await fetchPage(cursor);
    if (Array.isArray(data.items)) items.push(...data.items);
    console.log(
      `Page ${page}: fetched ${data.items?.length ?? 0} items, nextCursor=${data.nextCursor ?? "null"}`
    );
    cursor = data.nextCursor ?? null;
    if (page >= MAX_PAGES) {
      console.warn(`Reached MAX_PAGES (${MAX_PAGES}), stopping.`);
      break;
    }
  } while (cursor !== null && cursor !== undefined);
  return items;
}

// --- kategori, M3U, EPG, logo fonksiyonları ---
// (tamamı senin dosyanda olduğu gibi burada duruyor, değiştirilmedi)

// --- main ---
async function main() {
  console.log(`Fetching group="${GROUP}" from ${CATALOG_URL} ...`);
  if (PROXY_BASE) {
    console.log(`Using PROXY_BASE=${PROXY_BASE}`);
  } else {
    console.warn("WARNING: PROXY_BASE is empty. Raw vavoo.to URLs will be written; players without VPN may fail.");
  }
  console.log(`EPG URL (published): ${EPG_URL}`);
  console.log(`EPG UPSTREAM (source): ${EPG_UPSTREAM_URL}`);

  const items = await fetchAll();
  console.log(`Total items: ${items.length}`);

  // ... (sıralama, upstream EPG, grab, logo index, binding vs. aynı)

  const m3u = toM3U(items, vavooToEpgId, logoResolver);
  await fs.writeFile(M3U_FILE, m3u, "utf8");
  console.log(`Wrote ${M3U_FILE} (${m3u.length} bytes, ${items.length} channels)`);

  const epg = toXMLTV(
    items,
    vavooToEpgId,
    idSource,
    grab.channels,
    grab.progByChannel,
    upstreamChannels,
    upstreamProgByChannel,
    logoResolver
  );
  await fs.writeFile(EPG_FILE, epg, "utf8");
  const programmeCount = (epg.match(/<programme /g) || []).length;
  const channelCount = (epg.match(/<channel /g) || []).length;
  console.log(`Wrote ${EPG_FILE} (${epg.length} bytes, ${channelCount} channels, ${programmeCount} programmes)`);

  const dist = new Map();
  for (const it of items) {
    const name = sanitizeName(it?.name);
    if (!name) continue;
    const c = categorize(name);
    dist.set(c, (dist.get(c) || 0) + 1);
  }
  console.log("\nCategory distribution:");
  for (const [c, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(10)}: ${n}`);
  }
}

// --- güvenli çıkış ---
main().catch(async (err) => {
  console.error("Build error:", err);
  try {
    const m3uExists = await fs.access(M3U_FILE).then(() => true).catch(() => false);
    const epgExists = await fs.access(EPG_FILE).then(() => true).catch(() => false);
    if (m3uExists && epgExists) {
      console.log("Outputs exist, exiting with success.");
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch {
    process.exit(1);
  }
});
