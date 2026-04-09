const fs = require("fs");
const path = require("path");

const VALANTIS_NPCS_URL = "https://valantis.online/about/npcs";
const DEFAULT_CACHE_FILE = path.join(__dirname, "cache", "valantis-npc-buys.json");
const CACHE_TTL_MS = Number(process.env.TIBIA_CACHE_TTL_MINUTES || 360) * 60 * 1000;
const FETCH_TIMEOUT_MS = Number(process.env.TIBIA_FETCH_TIMEOUT_MS || 20000);
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.TIBIA_FETCH_CONCURRENCY || 12));

function normalizeItemName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "user-agent": "makarena-tibia-bot/1.0 (+https://valantis.online)"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }

  return response.text();
}

function extractNpcUrls(indexHtml) {
  const matches = indexHtml.match(/https:\/\/valantis\.online\/about\/npcs\/[^"#\s]+/g) || [];
  return Array.from(new Set(matches));
}

function extractNpcMeta(html) {
  const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const locationMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);

  return {
    npcName: stripTags(nameMatch?.[1] || "Unknown NPC"),
    location: stripTags(locationMatch?.[1] || "")
  };
}

function extractBuySection(html) {
  const match = html.match(/<h3>\s*Buys\s*<\/h3>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
  return match?.[1] || "";
}

function extractBuyRows(sectionHtml) {
  const rowPattern = /<tr>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rowMatch = rowPattern.exec(sectionHtml);

  while (rowMatch) {
    const rowHtml = rowMatch[1];
    const itemMatch = rowHtml.match(/<a[^>]+\/about\/itemPage\/[^"]+["'][^>]*>\s*<span>([^<]+)<\/span>/i);
    const priceMatch = rowHtml.match(/>\s*([\d.,]+)\s*gold\s*</i);

    if (itemMatch && priceMatch) {
      rows.push({
        name: stripTags(itemMatch[1]),
        price: Number(priceMatch[1].replace(/[^\d]/g, ""))
      });
    }

    rowMatch = rowPattern.exec(sectionHtml);
  }

  return rows.filter(row => row.name && Number.isFinite(row.price) && row.price > 0);
}

function buildIndexFromOffers(offers) {
  const items = new Map();

  for (const offer of offers) {
    const key = normalizeItemName(offer.name);
    const current = items.get(key);

    if (!current || offer.sellPrice > current.sellPrice) {
      items.set(key, {
        name: offer.name,
        sellPrice: offer.sellPrice,
        sellTo: {
          name: offer.sellTo.name,
          location: offer.sellTo.location
        },
        offers: [offer]
      });
      continue;
    }

    if (offer.sellPrice === current.sellPrice) {
      current.offers.push(offer);
    }
  }

  return items;
}

async function crawlValantisBuys() {
  const npcIndexHtml = await fetchText(VALANTIS_NPCS_URL);
  const npcUrls = extractNpcUrls(npcIndexHtml);
  const offers = [];
  let index = 0;

  async function worker() {
    while (index < npcUrls.length) {
      const currentIndex = index;
      index += 1;

      const npcHtml = await fetchText(npcUrls[currentIndex]);
      const meta = extractNpcMeta(npcHtml);
      const buyRows = extractBuyRows(extractBuySection(npcHtml));

      for (const row of buyRows) {
        offers.push({
          name: row.name,
          sellPrice: row.price,
          sellTo: {
            name: meta.npcName,
            location: meta.location
          }
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, npcUrls.length) }, () => worker()));

  return {
    source: "Valantis NPC shops",
    generatedAt: new Date().toISOString(),
    itemCount: offers.length,
    offers
  };
}

function readCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return null;

  try {
    const raw = fs.readFileSync(cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    const ageMs = Date.now() - new Date(parsed.generatedAt || 0).getTime();

    if (!parsed.offers || !Number.isFinite(ageMs) || ageMs > CACHE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("[tibia] Could not read Valantis cache:", error);
    return null;
  }
}

function writeCache(cacheFile, payload) {
  ensureDirectory(cacheFile);
  fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
}

function createDatabasePayload(rawPayload, cacheFile, fromCache) {
  return {
    items: buildIndexFromOffers(rawPayload.offers || []),
    sourceName: rawPayload.source || "Valantis NPC shops",
    sourcePath: cacheFile,
    generatedAt: rawPayload.generatedAt || new Date().toISOString(),
    fromCache,
    itemCount: rawPayload.itemCount || (rawPayload.offers || []).length
  };
}

async function loadValantisDatabase() {
  const cacheFile = process.env.TIBIA_CACHE_FILE || DEFAULT_CACHE_FILE;
  const cached = readCache(cacheFile);

  if (cached) {
    return createDatabasePayload(cached, cacheFile, true);
  }

  const fresh = await crawlValantisBuys();
  writeCache(cacheFile, fresh);
  return createDatabasePayload(fresh, cacheFile, false);
}

module.exports = {
  loadValantisDatabase,
  normalizeItemName
};
