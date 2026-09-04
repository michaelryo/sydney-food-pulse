import { readFile, writeFile } from 'node:fs/promises';

const DATABASE_PATH = 'dist/data/restaurant-database.json';
const USER_AGENT = 'SydneyFoodPulse/2.0 (GitHub Actions; public-food-news-indexer)';
const LOOKBACK = '14d';
const MAX_RESULTS_PER_SEARCH = 8;
const MAX_PAGES_TO_ENRICH = 90;
const MAX_NEW_RESTAURANTS_PER_RUN = 10;
const FETCH_TIMEOUT_MS = 12_000;

const searches = [
  { query: 'Sydney restaurant opening', topic: 'New opening', weight: 3 },
  { query: 'Sydney restaurant just opened', topic: 'New opening', weight: 3 },
  { query: 'Sydney new restaurant review', topic: 'Review', weight: 3 },
  { query: 'Sydney best new restaurant', topic: 'Editors pick', weight: 3 },
  { query: 'Sydney food viral restaurant', topic: 'Social buzz', weight: 2 },
  { query: 'Sydney restaurant TikTok viral', topic: 'TikTok signal', weight: 2 },
  { query: 'Sydney restaurant Instagram viral', topic: 'Instagram signal', weight: 2 },
  { query: 'Sydney restaurant food blogger', topic: 'Creator signal', weight: 2 },

  { query: 'Sydney Inner West restaurant opening', topic: 'Inner West opening', weight: 3 },
  { query: 'Sydney CBD restaurant opening', topic: 'CBD opening', weight: 3 },
  { query: 'Sydney Eastern Suburbs restaurant opening', topic: 'Eastern Suburbs opening', weight: 3 },
  { query: 'Sydney Northern Beaches restaurant opening', topic: 'Northern Beaches opening', weight: 3 },
  { query: 'Sydney cheap eats restaurant new', topic: 'Cheap eat', weight: 3 },
  { query: 'Sydney restaurant under $30', topic: 'Cheap eat', weight: 2 },

  { query: 'site:broadsheet.com.au/sydney/food-and-drink Sydney restaurant', topic: 'Broadsheet', weight: 3 },
  { query: 'site:concreteplayground.com/sydney Sydney restaurant', topic: 'Concrete Playground', weight: 3 },
  { query: 'site:goodfood.com.au Sydney restaurant', topic: 'Good Food', weight: 3 },
  { query: 'site:timeout.com/sydney Sydney restaurant', topic: 'Time Out', weight: 3 },
  { query: 'site:theurbanlist.com Sydney restaurant', topic: 'Urban List', weight: 3 },
  { query: 'site:gourmettraveller.com.au Sydney restaurant', topic: 'Gourmet Traveller', weight: 3 },
  { query: 'site:notquitenigella.com Sydney restaurant', topic: 'Not Quite Nigella', weight: 3 },
  { query: 'site:sitchu.com.au Sydney restaurant', topic: 'Sitchu', weight: 2 }
];

const communityFeeds = [
  {
    url: 'https://www.reddit.com/r/sydney/search.rss?q=restaurant&restrict_sr=on&sort=new&t=week',
    source: 'Reddit r/sydney',
    topic: 'Community signal',
    weight: 1
  },
  {
    url: 'https://www.reddit.com/r/foodies_sydney/search.rss?q=restaurant&restrict_sr=on&sort=new&t=week',
    source: 'Reddit r/foodies_sydney',
    topic: 'Community signal',
    weight: 1
  }
];

const sourceWeight = {
  Broadsheet: 3,
  'Concrete Playground': 3,
  'Good Food': 3,
  'Time Out': 3,
  'Gourmet Traveller': 3,
  'Not Quite Nigella': 3,
  'The Urban List': 3,
  Sitchu: 2,
  'Reddit r/sydney': 1,
  'Reddit r/foodies_sydney': 1
};

const suburbRules = [
  { match: /\b(sydney cbd|cbd|angel place|circular quay|the rocks|barangaroo|darling harbour|town hall|wynyard|haymarket|chippendale)\b/i, suburb: 'Sydney CBD', area: 'CBD & Inner City', coordinates: [-33.8688, 151.2093] },
  { match: /\b(surry hills|darlinghurst|potts point|woolloomooloo|paddington|redfern|waterloo|alexandria)\b/i, suburb: 'Surry Hills', area: 'CBD & Inner City', coordinates: [-33.8830, 151.2090] },
  { match: /\b(newtown|enmore|marrickville|petersham|leichhardt|annandale|glebe|balmain|rozelle|ashfield|summer hill|stanmore)\b/i, suburb: 'Newtown', area: 'Inner West', coordinates: [-33.8981, 151.1790] },
  { match: /\b(bondi junction)\b/i, suburb: 'Bondi Junction', area: 'Eastern Suburbs', coordinates: [-33.8925, 151.2503] },
  { match: /\b(bondi|bronte|coogee|clovelly|randwick|maroubra|double bay|rose bay|rushcutters bay|vaucluse)\b/i, suburb: 'Bondi', area: 'Eastern Suburbs', coordinates: [-33.8915, 151.2767] },
  { match: /\b(manly|freshwater|dee why|newport|avalon|palm beach|collaroy|narrabeen)\b/i, suburb: 'Manly', area: 'Northern Beaches', coordinates: [-33.8005, 151.2869] },
  { match: /\b(cabramatta|canley vale|liverpool)\b/i, suburb: 'Cabramatta', area: 'South West Sydney', coordinates: [-33.8972, 150.9346] },
  { match: /\b(parramatta|granville|westmead|harris park)\b/i, suburb: 'Parramatta', area: 'Western Sydney', coordinates: [-33.8150, 151.0011] }
];

const cuisineRules = [
  { match: /\b(japanese|omakase|sushi|ramen|yakitori|izakaya)\b/i, value: 'Japanese' },
  { match: /\b(italian|pasta|trattoria|osteria|pizzeria|pizza)\b/i, value: 'Italian' },
  { match: /\b(thai|pad thai|som tam|khao soi)\b/i, value: 'Thai' },
  { match: /\b(vietnamese|pho|banh mi|bánh mì)\b/i, value: 'Vietnamese' },
  { match: /\b(malaysian|nyonya|laksa|char koay teow)\b/i, value: 'Malaysian' },
  { match: /\b(chinese|cantonese|dim sum|peking duck|dumpling)\b/i, value: 'Chinese' },
  { match: /\b(korean|bibimbap|korean fried chicken|jjigae)\b/i, value: 'Korean' },
  { match: /\b(mexican|taco|taqueria|tortilla)\b/i, value: 'Mexican' },
  { match: /\b(lebanese|middle eastern|falafel|shawarma)\b/i, value: 'Middle Eastern' },
  { match: /\b(indian|curry|tandoori|biryani)\b/i, value: 'Indian' },
  { match: /\b(burger|smash burger)\b/i, value: 'Burgers' },
  { match: /\b(seafood|modern australian|australian bistro)\b/i, value: 'Modern Australian' }
];

function decode(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decode(match[1]) : '';
}

function normaliseName(value = '') {
  return value
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

function cleanText(html = '') {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function htmlMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }

  return '';
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { url: response.url, text: await response.text() };
}

async function googleNewsSearch({ query, topic, weight }) {
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${LOOKBACK}`)}&hl=en-AU&gl=AU&ceid=AU:en`;
  const { text } = await fetchText(feedUrl);

  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1];
      return {
        title: xmlTag(block, 'title'),
        url: xmlTag(block, 'link'),
        source: xmlTag(block, 'source') || 'Public food news',
        publishedAt: xmlTag(block, 'pubDate'),
        topic,
        weight
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, MAX_RESULTS_PER_SEARCH);
}

async function readCommunityFeed({ url, source, topic, weight }) {
  const { text } = await fetchText(url);

  return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .map((match) => {
      const block = match[1];
      const href = block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || xmlTag(block, 'link');

      return {
        title: xmlTag(block, 'title'),
        url: href,
        source,
        publishedAt: xmlTag(block, 'updated') || xmlTag(block, 'published'),
        topic,
        weight
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, MAX_RESULTS_PER_SEARCH);
}

async function inBatches(items, worker, concurrency = 5) {
  const output = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = items[index++];
      try {
        const result = await worker(current);
        if (result) output.push(result);
      } catch (error) {
        console.warn(`Skipped ${current.url || current.query}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, run));
  return output;
}

function findJsonLdRestaurant(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  function visit(node) {
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }

    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    const isRestaurant = types.some((type) =>
      /restaurant|foodestablishment|cafeorcoffeeshop|bakery/i.test(String(type))
    );

    if (isRestaurant && node.name) return node;

    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found) return found;
    }

    return null;
  }

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const restaurant = visit(parsed);
      if (restaurant) return restaurant;
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return null;
}

function extractRestaurantName(title, jsonLd) {
  if (jsonLd?.name && jsonLd.name.length < 80) return jsonLd.name.trim();

  const clean = title
    .replace(/\s+\|\s+[^|]+$/, '')
    .replace(/\s+-\s+(Broadsheet|Time Out|Good Food|Concrete Playground|The Urban List|Gourmet Traveller).*$/i, '')
    .trim();

  const patterns = [
    /^(?:just\s+)?(?:opened|opening now|new)\s*:\s*([^,|–—]{2,70})/i,
    /^([^|–—]{2,70}?)\s+(?:opens|opened|is opening|lands|arrives|brings|hits|returns)\b/i,
    /\b(?:restaurant|bar|bistro|cafe|café|trattoria|pizzeria|bakery|taqueria)\s+(?:called|named)?\s*[“"']?([A-Z][\w’'&.-]*(?:\s+[A-Z][\w’'&.-]*){0,4})/i,
    /\bintroducing\s+([A-Z][\w’'&.-]*(?:\s+[A-Z][\w’'&.-]*){0,4})/i
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match) continue;

    const candidate = match[1]
      .replace(/[“”"'.,:;]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      candidate.length >= 3 &&
      candidate.length <= 60 &&
      !/^(sydney|new restaurant|a restaurant|the restaurant|best restaurants?)$/i.test(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function extractAddress(text, jsonLd) {
  const address = jsonLd?.address;

  if (address && typeof address === 'object') {
    const parts = [
      address.streetAddress,
      address.addressLocality,
      address.addressRegion,
      address.postalCode
    ].filter(Boolean);

    if (parts.length >= 2) return parts.join(', ').replace(/\s+/g, ' ').trim();
  }

  if (typeof address === 'string' && address.length > 10) return address.trim();

  const match = text.match(
    /\b(?:shop\s*[a-z0-9/-]+,?\s*)?\d+[a-z]?(?:\/\d+[a-z]?)?\s+[\w’'&.-]+(?:\s+[\w’'&.-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|place|pl|esplanade|parade|pde|drive|dr|way)\b[^.]{0,80}/i
  );

  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function resolveLocation(text) {
  return suburbRules.find((entry) => entry.match.test(text)) || null;
}

function storedCoordinates(restaurant) {
  return resolveLocation([restaurant.suburb, restaurant.area, restaurant.address].filter(Boolean).join(' '))?.coordinates;
}

function formatAddress(address, location) {
  if (!address || !location) return '';

  const hasSuburb = new RegExp(location.suburb, 'i').test(address);
  const hasState = /\bNSW\b/i.test(address);

  return [
    address.replace(/[,. ]+$/, ''),
    hasSuburb ? '' : location.suburb,
    hasState ? '' : 'NSW'
  ]
    .filter(Boolean)
    .join(', ');
}

function inferCuisine(text) {
  return cuisineRules.find((rule) => rule.match.test(text))?.value || '';
}

function extractPricePerPerson(text, sourceUrl, checkedAt) {
  const direct = [...text.matchAll(/\$ ?(\d{1,3}(?:\.\d{1,2})?)\s*(?:pp|p\.?p\.?|per person|per head)/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 10 && value <= 500);

  if (direct.length) {
    const value = Math.round(direct[0]);
    return {
      currency: 'AUD',
      min: value,
      max: value,
      label: `$${value} pp`,
      basis: 'Published per-person or per-head price',
      confidence: 'high',
      sourceUrl,
      lastVerifiedAt: checkedAt
    };
  }

  const explicitRange = text.match(/\$ ?(\d{1,3})\s*(?:-|–|to)\s*\$ ?(\d{1,3})/);
  if (explicitRange) {
    const min = Number(explicitRange[1]);
    const max = Number(explicitRange[2]);

    if (min >= 8 && max <= 300 && min < max) {
      return {
        currency: 'AUD',
        min,
        max,
        label: `$${min}–$${max} pp`,
        basis: 'Published menu price range',
        confidence: 'high',
        sourceUrl,
        lastVerifiedAt: checkedAt
      };
    }
  }

  const prices = [...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{1,2})?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 8 && value <= 180)
    .sort((a, b) => a - b);

  if (prices.length < 3) return null;

  // Avoid using the cheapest snack and the most expensive premium item.
  const min = Math.round(prices[Math.floor((prices.length - 1) * 0.35)] / 5) * 5;
  const max = Math.round(prices[Math.floor((prices.length - 1) * 0.9)] / 5) * 5;

  if (min < 10 || max < min || max > 200) return null;

  return {
    currency: 'AUD',
    min,
    max: Math.max(max, min + 5),
    label: `$${min}–$${Math.max(max, min + 5)} pp`,
    basis: 'Estimated from multiple published menu prices; food only',
    confidence: 'medium',
    sourceUrl,
    lastVerifiedAt: checkedAt
  };
}

function extractMenuHighlights(text) {
  const matches = [
    ...text.matchAll(/(?:highlights include|menu highlights|standouts include|known for|signature dishes? include|expect)\s*:?\s*([^.!?]{20,300})/gi)
  ];

  const candidates = matches
    .flatMap((match) => match[1].split(/,|;|\band\b/gi))
    .map((value) => value.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= 4 && value.length <= 80)
    .filter((value) => !/^(the|a|an|with|and|or)$/i.test(value));

  return uniqueBy(candidates, (value) => value.toLowerCase()).slice(0, 5);
}

function extractDietarySignals(text) {
  const lower = text.toLowerCase();

  return {
    vegetarian: /\bvegetarian\b|\bvegan\b/.test(lower),
    vegan: /\bvegan\b/.test(lower),
    glutenFree: /\bgluten[- ]free\b/.test(lower),
    dairyFree: /\bdairy[- ]free\b/.test(lower),
    chickenAvailable: /\bchicken\b/.test(lower),
    confidence: 'page-text signal only'
  };
}

function googleMapsUrl(restaurant) {
  const query = [restaurant.name, restaurant.address, restaurant.suburb, 'Sydney NSW']
    .filter(Boolean)
    .join(', ');

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function newsKey(item) {
  return `${item.title.toLowerCase()}|${item.url}`;
}

function isLikelyRestaurantStory(title, text) {
  return /\b(restaurant|bar|bistro|cafe|café|bakery|trattoria|pizzeria|taqueria|diner|eatery|menu|chef|opening|opens|opened)\b/i.test(
    `${title} ${text.slice(0, 4000)}`
  );
}

async function enrichNewsItem(item, checkedAt) {
  const { url, text: html } = await fetchText(item.url);
  const pageText = cleanText(html);
  const jsonLd = findJsonLdRestaurant(html);
  const pageTitle = htmlMeta(html, 'og:title') || item.title;
  const description = htmlMeta(html, 'og:description') || htmlMeta(html, 'description');
  const combined = `${pageTitle}\n${description}\n${pageText}`;

  if (!isLikelyRestaurantStory(pageTitle, combined)) return null;

  const name = extractRestaurantName(pageTitle, jsonLd);
  const location = resolveLocation(combined);
  const address = formatAddress(extractAddress(combined, jsonLd), location);
  const cuisine = inferCuisine(`${pageTitle}\n${description}\n${pageText.slice(0, 15_000)}`);
  const pricePerPerson = extractPricePerPerson(pageText, url, checkedAt);

  if (!name || !location || !address || !cuisine || !pricePerPerson) return null;

  const source = {
    title: item.title,
    url,
    source: item.source,
    topic: item.topic,
    publishedAt: item.publishedAt
  };

  return {
    name,
    cuisine,
    area: location.area,
    suburb: location.suburb,
    address,
    coordinates: location.coordinates,
    googleMapsUrl: googleMapsUrl({ name, address, suburb: location.suburb }),
    trend: item.topic === 'Cheap eat' ? 'Cheap eat' : 'Newly found',
    summary: description || `${name} was found in recent ${item.source} coverage.`,
    pricePerPerson,
    menuHighlights: extractMenuHighlights(pageText),
    dietary: extractDietarySignals(pageText),
    source,
    signalScore: (item.weight || 1) + (sourceWeight[item.source] || 1)
  };
}

function mergeNews(existing = [], incoming = []) {
  return uniqueBy([...incoming, ...existing], newsKey)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 5);
}

function relatedNews(name, allNews) {
  const target = normaliseName(name);

  return allNews.filter((item) => {
    const headline = normaliseName(item.title);
    return headline.includes(target) || target.includes(headline);
  });
}

function mergeRestaurant(existing, candidate, allNews, updatedAt) {
  const matchingNews = mergeNews(
    existing.latestNews || [],
    [...relatedNews(existing.name, allNews), candidate?.source].filter(Boolean)
  );

  if (!candidate) {
    return {
      ...existing,
      googleMapsUrl: existing.googleMapsUrl || googleMapsUrl(existing),
      coordinates: existing.coordinates || storedCoordinates(existing),
      latestNews: matchingNews,
      updatedAt: matchingNews.length ? updatedAt : existing.updatedAt || updatedAt
    };
  }

  return {
    ...existing,
    cuisine: existing.cuisine === 'To be confirmed' ? candidate.cuisine : existing.cuisine,
    area: existing.area || candidate.area,
    suburb: existing.suburb || candidate.suburb,
    address: existing.address || candidate.address,
    coordinates: existing.coordinates || candidate.coordinates || storedCoordinates({ ...existing, ...candidate }),
    googleMapsUrl: existing.googleMapsUrl || candidate.googleMapsUrl,
    trend: candidate.signalScore >= 5 ? candidate.trend : existing.trend || candidate.trend,
    summary: existing.summary?.includes('Details will be expanded')
      ? candidate.summary
      : existing.summary || candidate.summary,
    pricePerPerson: candidate.pricePerPerson || existing.pricePerPerson,
    menuHighlights: uniqueBy(
      [...(existing.menuHighlights || []), ...(candidate.menuHighlights || [])],
      (value) => value.toLowerCase()
    ).slice(0, 5),
    dietary: candidate.dietary || existing.dietary,
    source: existing.source || candidate.source.url,
    latestNews: matchingNews,
    updatedAt
  };
}

const updatedAt = new Date().toISOString();

const database = JSON.parse(await readFile(DATABASE_PATH, 'utf8'));
delete database.dailyLeads;

const newsResults = await inBatches(searches, googleNewsSearch, 4);
const communityResults = await inBatches(communityFeeds, readCommunityFeed, 2);

const allNews = uniqueBy(
  [...newsResults.flat(), ...communityResults.flat()],
  (item) => `${item.title.toLowerCase()}|${item.url}`
).slice(0, MAX_PAGES_TO_ENRICH);

if (!allNews.length) {
  throw new Error('No public food-news results were returned; database was left unchanged.');
}

const candidates = await inBatches(
  allNews,
  (item) => enrichNewsItem(item, updatedAt),
  5
);

const candidatesByName = new Map();

for (const candidate of candidates) {
  const key = normaliseName(candidate.name);
  const existing = candidatesByName.get(key);

  if (!existing || candidate.signalScore > existing.signalScore) {
    candidatesByName.set(key, candidate);
  }
}

const restaurants = Array.isArray(database.restaurants) ? database.restaurants : [];
const knownNames = new Set(restaurants.map((restaurant) => normaliseName(restaurant.name)));

const refreshedRestaurants = restaurants.map((restaurant) =>
  mergeRestaurant(
    restaurant,
    candidatesByName.get(normaliseName(restaurant.name)),
    allNews,
    updatedAt
  )
);

let nextId = Math.max(0, ...refreshedRestaurants.map((restaurant) => Number(restaurant.id) || 0)) + 1;
let added = 0;

for (const candidate of [...candidatesByName.values()].sort((a, b) => b.signalScore - a.signalScore)) {
  if (added >= MAX_NEW_RESTAURANTS_PER_RUN) break;
  if (knownNames.has(normaliseName(candidate.name))) continue;

  // New listings require real address, cuisine and an explicit/derived price range.
  if (
    !candidate.address ||
    !candidate.cuisine ||
    !candidate.pricePerPerson ||
    candidate.pricePerPerson.confidence === 'low'
  ) {
    continue;
  }

  const linkedNews = mergeNews([], [
    candidate.source,
    ...relatedNews(candidate.name, allNews)
  ]);

  refreshedRestaurants.push({
    id: nextId++,
    name: candidate.name,
    cuisine: candidate.cuisine,
    area: candidate.area,
    suburb: candidate.suburb,
    address: candidate.address,
    googleMapsUrl: candidate.googleMapsUrl,
    coordinates: candidate.coordinates,
    trend: candidate.trend,
    summary: candidate.summary,
    cons: 'Review consensus and detailed dietary suitability have not yet been independently verified.',
    pricePerPerson: candidate.pricePerPerson,
    menuHighlights: candidate.menuHighlights,
    dietary: candidate.dietary,
    themes: uniqueBy(
      [candidate.trend.toLowerCase(), candidate.cuisine.toLowerCase(), candidate.source.topic.toLowerCase()],
      (value) => value
    ),
    comments: [],
    source: candidate.source.url,
    latestNews: linkedNews,
    updatedAt
  });

  knownNames.add(normaliseName(candidate.name));
  added += 1;
}

database.updatedAt = updatedAt;
database.restaurants = refreshedRestaurants;

await writeFile(DATABASE_PATH, `${JSON.stringify(database, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      message: 'Restaurant database updated',
      totalProfiles: database.restaurants.length,
      addedProfiles: added,
      scannedNewsItems: allNews.length,
      verifiedCandidates: candidates.length
    },
    null,
    2
  )
);