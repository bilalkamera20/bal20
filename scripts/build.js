"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";
const GROUP = "Turkey";
const M3U_FILE = path.join(__dirname, "..", "iptv.m3u");
const EPG_FILE = path.join(__dirname, "..", "epg.xml");
const FETCH_TIMEOUT_MS = 5000;   // 5 saniye timeout
const RETRY_ATTEMPTS = 2;        // 2 deneme
const MAX_PAGES = 50;            // maksimum 50 sayfa

// Cloudflare Workers proxy base (no trailing slash). Set via GitHub Actions variable.
const PROXY_BASE = (process.env.PROXY_BASE || "").replace(/\/+$/, "");

// Where players should fetch the generated XMLTV EPG.
const EPG_URL =
  process.env.EPG_URL ||
  "https://raw.githubusercontent.com/kadirmetin/vavoo-iptv/main/epg.xml";

// Vavoo requires browser-like headers
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

function buildBody(cursor) {
  return JSON.stringify({
    language: "de",
    region: "DE",
    catalogId: "iptv",
    id: "",
