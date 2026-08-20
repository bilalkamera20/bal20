"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";
const GROUP = "Turkey";
const M3U_FILE = path.join(__dirname, "..", "iptv.m3u");
const FETCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 5;

// -- Proxy Ayrıştırma Ve Temizleme Fonksiyonu ------------------------------
function parseProxies(envVal) {
  if (!envVal || !envVal.trim()) return [];
  
  // Virgül, boşluk veya satır başlarına göre güvenli ayrıştırma yapar
  return envVal
    .split(/[\s,]+/)
    .map((p) => p.trim().replace(/\/+$/, ""))
    .filter((p) => p.startsWith("http://") || p.startsWith("https://"));
}

const ENV_PROXIES = parseProxies(process.env.PROXY_BASE);

// Eğer GitHub'dan değer çekilemezse kullanılacak yedek liste
const FALLBACK_PROXIES = [
  "https://halil.bilalkamera20.workers.dev",
  "https://adam.bilalkamera20.workers.dev",
  "https://ner.bilalkamera20.workers.dev",
  "https://nur.bilalkamera20.workers.dev",
  "https://vavoo-iptv-proxy.bilalkamera20.workers.dev",
  "https://nernur.bilalkamera20.workers.dev",
  "https://balkica.bilalkamera20.workers.dev",
  "https://bilal.bilalkamera20.workers.dev",
  "https://vav20.bilalkamera20.workers.dev",
  "https://hmeb.bilalkamera20.workers.dev"
];

const PROXY_LIST = ENV_PROXIES.length > 0 ? ENV_PROXIES : FALLBACK_PROXIES;
let proxyIndex = 0;

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,tr;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  origin: "https://vavoo.to",
  referer: "https://vavoo.to/live",
  dnt: "1",
  "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(CATALOG_URL, {
        method: "POST",
        headers: HEADERS,
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const data = await res.json();
      if (data && data.error) throw new Error(`Vavoo hatası: ${data.error}`);

      return data;
    } catch (err) {
      lastErr = err;
      const wait = 1000 * attempt;
      console.warn(
        `Deneme ${attempt}/${MAX_RETRIES} başarısız (${err.message}). ${wait}ms sonra tekrar deneniyor...`
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

    if (Array.isArray(data.items) && data.items.length > 0) {
      items.push(...data.items);
    }

    console.log(
      `Sayfa ${page}: ${data.items?.length ?? 0} kanal çekildi, nextCursor=${data.nextCursor ?? "null"}`
    );

    cursor = data.nextCursor ?? null;

    if (page >= MAX_PAGES) {
      console.warn(`Maksimum sayfa sınırına ulaşıldı (${MAX_PAGES}).`);
      break;
    }
  } while (cursor !== null && cursor !== undefined);

  return items;
}

// -- Kanal İsmi Temizleme ve Kategorilendirme -----------------------------

function sanitizeName(name) {
  return String(name ?? "")
    .replace(/^\s*(?:[A-Z0-9-]+\s+)*TR:\s*/i, "")
    .replace(/\s*\.(?:b|c|s)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function normalizeForCategory(name) {
  const clean = sanitizeName(name);
  return clean
    .replace(/\s+(?:UHD|FHD|HD\+|HD|SD|HEVC|RAW|H265|H\.265|FEED)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_RULES = [
  {
    name: "TR SPOR",
    re: /\b(BEIN SPO[RT]{0,3}S?|BEIN 1|S[- ]?SPORTS?|S SPORT|SPOR SMART|EUROSPORT|NBA|TJK TV|TIVIBU ?SPOR|TIVIBUSPOR|TRT SPOR|TABII SPOR|EXXEN SPO[RT]?|HT SPOR|EKOL SPOR|SPORTS TV|IDMAN TV|GALATASARAY TV|FB TV|GS TV|SARAN SPORT|SMART SPOR|SPOR|SPORT)\b/i,
  },
  {
    name: "TR ÇOCUK",
    re: /\b(CARTOON|BOOMERANG|DISNEY|NICK(?:ELODEON|TOONS|JR|JUNIOR)?|BABY ?TV|BABYTV|M[İI]?N ?KA|MINIKA|POKEMON|POKÉMON|ANIMATION|ANIMASYON|TRT ?[ÇC]?OCUK|[ÇC]OCUK|BEN ?10|ANGRY BIRDS|CAILLOU|PEPPA|PEPE|HEIDI|SIRINLER|TOM & JERRY|SPIDERMAN|BARBIE|PIJAMA|PIRIL|RAFADAN|KELOGLAN|KUKULI|KUKILI|KOSTEBEK|CHICKY|BOOBA|WAKFU|GABBY|TAYO|NILOYA|PISI|LEYLEK|MASAL|CANIM KARDESIM|ADIBESA|MOMO|ALVIN|VIKINGLER|TRANSFORMERS|TROL AVCILARI|SMART COCUK|ILAHI COCUK|CILGIN ORMAN|KRAL SAKIR|SERCE KUS|ITFAYECI SAM|MUFFETIS|MAYMUNLAR|ELIF VE|ELIFIN|MIMOCAN|HAPSUU|RUYA TRENI|MASA KOCAAYI|PAK PIRPIR|LIMON ZEYTIN|GONCA TV|NASREDDIN|SEKER HOCA|SEVIMLI DOSTLAR|PAW PETROL|OSCAR COLLERDE|CBEEBIES|DUCK TV|JIM ?JAM|ENGLISH CLUB TV|EBA TV|PATRON BEBEK|DA VINC KIDS|DA VINCI KIDS)\b/i,
  },
  {
    name: "TR BELGESEL",
    re: /\b(DISCOVERY|NATIONAL GEOGRAPHIC|NAT ?GEO|HISTORY|ANIMAL PLANET|DA VINCI|VIASAT|BBC EARTH|LOVE NATURE|TRT BELGESEL|EPIC DRAMA|TARIH TV|TARIM TV|TGRT BELGESEL|INVESTIGATION|DMAX|DOCUBOX|DOCU SCREEN|SCIENCE|IZ TV|YABAN|OUTDOOR|CHASSE|ANIMAUX|AGRO TV|CIFTCI TV|REDBULL TV|TLC)\b/i,
  },
  {
    name: "TR SİNEMA",
    re: /\b(SINEMA|S[İI]NEMA|CINEMA|SINEMAX|SINEVIZYON|MOVIES?|MOVIEMAX|MOVIESMART|BEIN MOVIES|BEIN BOX|BOX OFFICE|FX|FX HD|YESILCAM|YE[ŞS]ILCAM|GLOBAL BOX|PROTURK|FIX CINEMA|KINGBOX|ARENA BOX|SHOWMAX|SHOW MAX|REAL BOX|SMART BOX|FILMBOX|HORROR|OSCAR|KEMAL SUNAL|007|CINE ?1|AKSIYON|KORKU|DRAM|WESTERN|BILIM ?KURGU|SAVAS|IMBD|IMDB|FILM)\b/i,
  },
  {
    name: "TR DİZİ",
    re: /\b(SER[İI]ES|DIZI|BEIN SERIES|D[İI]Z[İI] ?SMART|DIZISMART)\b/i,
  },
  {
    name: "TR HABER",
    re: /\b(HABER|NEWS|BLOOMBERG|CNN|EKOTURK|EKO ?T[UÜ]RK|EKOL|A ?PARA|APARA|PARANIN|HALK TV|TELE ?1|SOZCU|SZC|BENGU ?T[UÜ]RK|BENGUTURK|TRT WORLD|DHA|LIDER HABER|FLASH HABER|MEDYA HABER|GLOBAL HABER|TRABZON HABER|BEIN SPORTS HABER|T[UÜ]RKHABER|HABERT[UÜ]RK|HABERT RK|ARTI TV)\b/i,
  },
  {
    name: "TR MÜZİK",
    re: /\b(POWER T[UÜ]RK|POWER ?TV|POWERTURK|POWER|KRAL POP|KRAL ?TV|KRAL|TRT M[UÜ]?Z[İI]?K|TRT MUZIK|NR ?1|NUMBER ?1|NUMBER ONE|DAMAR|ARABESK|AKUSTIK|AHMET KAYA|IBRAHIM ERKAL|IBRAHIM TATLISES|TATLISES|ZERRIN OZER|SEZEN AKSU|TARKAN|SELDA BAGCAN|CENGIZ KURTOGLU|MAHSUN KIRMIZIGUL|MUSLUM GURSES|YILDIZ TILBE|FERDI TAYFUR|MTV LIVE|VINTAGE MUSIC|RETRO TURK|MUZIK|FM TV|FMTV|REDBOX)\b/i,
  },
  {
    name: "TR RADYO",
    re: /\b(RADIO|RADYO|FM|MBAT FM|EFKAR FM|FMTV|POWERTURK|POWER FM|SHOW RADYO|ALEM FM|BABA RADYO|KRAL POP RADYO|PAL STATION|X NOSTALJI|RADIO ROCK|ISTANBUL FM)\b/i,
  },
  {
    name: "TR DİNİ",
    re: /\b(D[İI]YANET|AK[İI]?T|MEHTAP|H[İI]LAL|KUDUS|KUDÜS|SEMERKAND|LALEGUL|LÂLEGÜL|MERCAN TV|VUSLAT|KARDELEN|DIYAR TV|DOST TV|YOL TV|KANAL 7|TVNET|TRT DIYANET|TV5|REHBER|ILAHI|ILKE TV|MESAJ TV|SURELER|CEM TV)\b/i,
  },
  {
    name: "TR YAŞAM",
    re: /\b(24 KITCHEN|GURME|BEIN GURME|LIFESTYLE|LIFE TV|FASHION|WM TV|24 RAW|TVEM|AUTOMOTO|LINE TV|BILGILENDIRME|WOMAN)\b/i,
  },
  {
    name: "TR ULUSAL",
    re: /\b(TRT|TRT 1|TRT 2|TRT 3|TRT AVAZ|TRT T[UÜ]RK|TRT KURD[İI]?|TRT WORLD|TRT 4K|TRT EBA|KANAL D|ATV|STAR TV|STAR|SHOW TV|SHOW|NOW ?TV|NOW|TV8|TV8[.,]5|BEYAZ TV|BEYAZ|360|24 TV|A2|A HABER|A NEWS|A PARA|A SPOR|TV100|TV4|FLASH TV|TEVE2|CNN T[UÜ]RK|KRT|ULUSAL KANAL|DREAM TURK|NTV|EXXEN TV|TABII|ULKE TV)\b/i,
  },
  {
    name: "TR YEREL",
    re: /\b(ADANA|ADIYAMAN|AFYON|AKSARAY|ALANYA|ANKARA|ANTALYA|BURSA|ELAZIG|ERZURUM|ESKISEHIR|GAZIANTEP|KAHRAMANMARAS|KAYSERI|KOCAELI|KONYA|MALATYA|MERSIN|ORDU|SIVAS|TRABZON|URFA|IZMIR|KIBRIS|DENIZLI|KANAL 12|KANAL 15|KANAL 23|KANAL 24|KANAL 26|KANAL 3|KANAL 32|KANAL 33|KANAL 42|KANAL 58|KANAL 68|KANAL FIRAT|KANAL URFA|KANAL V|KARADENIZ|EGE|MELTEM|CAY TV|OLAY TV|TIVI 6|TV 41|TV 42|TV 52|TV 264)\b/i,
  },
];

function categorize(name) {
  const s = normalizeForCategory(name);
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(s)) return rule.name;
  }
  return "TR GENEL";
}

// -- M3U Dosyası Oluşturma ------------------------------------------------

function escapeAttr(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, "'");
}

function toStreamUrl(item) {
  if (!item?.url) return "";

  if (PROXY_LIST.length > 0) {
    const currentProxy = PROXY_LIST[proxyIndex];
    proxyIndex = (proxyIndex + 1) % PROXY_LIST.length;

    return `${currentProxy}/?url=${encodeURIComponent(item.url)}&master&transport=http&.m3u8`;
  }

  return item.url;
}

function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || !item.url) return false;
    const key = item.ids?.id ? `${item.ids.id}-${item.url}` : item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toM3U(items) {
  const lines = ["#EXTM3U"];
  for (const it of items) {
    const vavooId = it.ids?.id ?? "";
    const name = sanitizeName(it.name);
    if (!name) continue;

    const logo = it.logo || "";
    const group = categorize(name);
    const streamUrl = toStreamUrl(it);

    lines.push(
      `#EXTINF:-1 tvg-id="${escapeAttr(vavooId)}" tvg-name="${escapeAttr(name)}" tvg-logo="${escapeAttr(logo)}" group-title="${escapeAttr(group)}",${name}`
    );
    lines.push(streamUrl);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(`Veri çekiliyor: ${CATALOG_URL} ...`);
  console.log(`Algılanan ve Kullanılacak Aktif Proxy Sayısı: ${PROXY_LIST.length}`);

  const rawItems = await fetchAll();
  console.log(`Toplam ham kanal sayısı: ${rawItems.length}`);

  const items = deduplicateItems(rawItems);
  if (rawItems.length !== items.length) {
    console.log(`Mükerrer yayınlar temizlendi. Kalan kanal sayısı: ${items.length}`);
  }

  items.sort((a, b) => {
    const an = sanitizeName(a.name ?? "").toLocaleLowerCase("tr-TR");
    const bn = sanitizeName(b.name ?? "").toLocaleLowerCase("tr-TR");
    if (an < bn) return -1;
    if (an > bn) return 1;
    const ai = a.ids?.id ?? "";
    const bi = b.ids?.id ?? "";
    return ai.localeCompare(bi);
  });

  const m3u = toM3U(items);
  await fs.writeFile(M3U_FILE, m3u, "utf8");
  console.log(`Başarıyla oluşturuldu: ${M3U_FILE} (${items.length} kanal)`);
}

main().catch((err) => {
  console.error("Kritik Hata:", err);
  process.exit(1);
});
