import { readFile, writeFile, rename } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

function integer(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}: expected 1..${max}`);
  return value;
}
const DATABASE_PATH = process.env.DATABASE_PATH || 'dist/data/restaurant-database.json';
const LOOKBACK_DAYS = integer('DISCOVERY_LOOKBACK_DAYS', 30, 365);
const MAX_PAGES = integer('MAX_DISCOVERY_PAGES', 120, 500);
const MAX_NEW = integer('MAX_NEW_RESTAURANTS_PER_RUN', 30, 500);
const MAX_LOOKUPS = integer('MAX_DETAIL_LOOKUPS', 20, 100);
const USER_AGENT = process.env.DISCOVERY_USER_AGENT || 'SydneyFoodPulse/4.0 (+https://github.com/michaelryo/sydney-food-pulse)';
const DRY_RUN = process.env.DRY_RUN === 'true';
const SKIP_FETCH = process.env.SKIP_FETCH === 'true';
const stats = { feeds: [], pagesAttempted: 0, rejected: {}, accepted: 0, duplicates: 0, detailLookups: 0, crossPlatformResults: 0 };
const pageCache = new Map();
const blockedHosts = new Set();
function reject(reason, source = '') {
  stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
  console.warn(`[${reason}] ${String(source).slice(0, 220)}`);
}
const locationRules = [
  ['Palm Beach', 'Northern Beaches', -33.6015, 151.3238],
  ['Avalon', 'Northern Beaches', -33.6363, 151.3295],
  ['Newport', 'Northern Beaches', -33.6567, 151.3185],
  ['Narrabeen', 'Northern Beaches', -33.7138, 151.2987],
  ['Collaroy', 'Northern Beaches', -33.7321, 151.3012],
  ['Dee Why', 'Northern Beaches', -33.7510, 151.2890],
  ['Freshwater', 'Northern Beaches', -33.7780, 151.2854],
  ['Manly', 'Northern Beaches', -33.8005, 151.2869],
  ['Cabramatta', 'South West Sydney', -33.8972, 150.9346],
  ['Canley Vale', 'South West Sydney', -33.8864, 150.9437],
  ['Liverpool', 'South West Sydney', -33.9209, 150.9239],
  ['Parramatta', 'Western Sydney', -33.8150, 151.0011],
  ['Harris Park', 'Western Sydney', -33.8234, 151.0080],
  ['Granville', 'Western Sydney', -33.8345, 151.0120],
  ['Ashfield', 'Inner West', -33.8884, 151.1241],
  ['Summer Hill', 'Inner West', -33.8915, 151.1385],
  ['Leichhardt', 'Inner West', -33.8834, 151.1563],
  ['Marrickville', 'Inner West', -33.9104, 151.1559],
  ['Petersham', 'Inner West', -33.8945, 151.1540],
  ['Stanmore', 'Inner West', -33.8942, 151.1640],
  ['Enmore', 'Inner West', -33.8987, 151.1734],
  ['Newtown', 'Inner West', -33.8981, 151.1790],
  ['Annandale', 'Inner West', -33.8812, 151.1700],
  ['Glebe', 'Inner West', -33.8792, 151.1868],
  ['Balmain', 'Inner West', -33.8565, 151.1790],
  ['Rozelle', 'Inner West', -33.8610, 151.1700],
  ['Maroubra', 'Eastern Suburbs', -33.9500, 151.2420],
  ['Coogee', 'Eastern Suburbs', -33.9205, 151.2552],
  ['Randwick', 'Eastern Suburbs', -33.9149, 151.2416],
  ['Clovelly', 'Eastern Suburbs', -33.9125, 151.2609],
  ['Bronte', 'Eastern Suburbs', -33.9057, 151.2662],
  ['Bondi Beach', 'Eastern Suburbs', -33.8915, 151.2767],
  ['Bondi Junction', 'Eastern Suburbs', -33.8925, 151.2503],
  ['Double Bay', 'Eastern Suburbs', -33.8779, 151.2438],
  ['Rose Bay', 'Eastern Suburbs', -33.8705, 151.2685],
  ['Rushcutters Bay', 'CBD & Inner City', -33.8758, 151.2280],
  ['Potts Point', 'CBD & Inner City', -33.8738, 151.2223],
  ['Darlinghurst', 'CBD & Inner City', -33.8781, 151.2197],
  ['Surry Hills', 'CBD & Inner City', -33.8830, 151.2090],
  ['Woolloomooloo', 'CBD & Inner City', -33.8704, 151.2194],
  ['Paddington', 'CBD & Inner City', -33.8848, 151.2263],
  ['Redfern', 'CBD & Inner City', -33.8932, 151.2044],
  ['Waterloo', 'CBD & Inner City', -33.9003, 151.2070],
  ['Alexandria', 'CBD & Inner City', -33.9098, 151.1957],
  ['Chippendale', 'CBD & Inner City', -33.8863, 151.1997],
  ['Haymarket', 'CBD & Inner City', -33.8794, 151.2043],
  ['Pyrmont', 'CBD & Inner City', -33.8697, 151.1948],
  ['Barangaroo', 'CBD & Inner City', -33.8648, 151.2017],
  ['Darling Harbour', 'CBD & Inner City', -33.8749, 151.2008],
  ['The Rocks', 'CBD & Inner City', -33.8599, 151.2090],
  ['Circular Quay', 'CBD & Inner City', -33.8611, 151.2126],
  ['Sydney CBD', 'CBD & Inner City', -33.8688, 151.2093]
].map(([suburb, area, latitude, longitude]) => ({
  suburb,
  area,
  latitude,
  longitude,
  match: new RegExp(`\\b${suburb.replace(/ /g, '\\s+')}\\b`, 'i')
}));

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
  { match: /\b(indian|tandoori|biryani)\b/i, value: 'Indian' },
  { match: /\b(french|brasserie|bistro)\b/i, value: 'French' },
  { match: /\b(greek|taverna|souvlaki)\b/i, value: 'Greek' },
  { match: /\b(spanish|tapas)\b/i, value: 'Spanish' },
  { match: /\b(burger|smash burger)\b/i, value: 'Burgers' },
  { match: /\b(bakery|pastry|patisserie|pasticceria)\b/i, value: 'Bakery' },
  {
    match: /\b(seafood|modern australian|australian bistro)\b/i,
    value: 'Modern Australian'
  }
];


function decode(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, number) => Number(number)<=0x10ffff?String.fromCodePoint(Number(number)):"")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      parseInt(number,16)<=0x10ffff?String.fromCodePoint(parseInt(number,16)):""
    )
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(block, name) {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')
  );
  return match ? decode(match[1]) : '';
}

function normaliseName(value = '') {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normaliseAddress(value = '') {
  return value
    .toLowerCase()
    .replace(/\b(?:new south wales|nsw|australia)\b/g, ' ')
    .replace(/\b\d{4}\s*$/, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bparade\b/g, 'pde')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueBy(items, key) {
  return [
    ...new Map(
      items.filter(Boolean).map((item) => [key(item), item])
    ).values()
  ];
}

function truncate(value = '', maximum = 320) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;

  return `${clean
    .slice(0, maximum - 1)
    .replace(/\s+\S*$/, '')}…`;
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
    new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decode(match[1]);
  }

  return '';
}


function inferCuisine(text) {
  return cuisineRules.find((rule) => rule.match.test(text))?.value || '';
}


// Localities supplement the region filters. No suburb coordinates are saved.
for (const [area, suburbs] of [
  ['North Shore', ['Chatswood', 'Crows Nest', 'St Leonards', 'North Sydney', 'Neutral Bay', 'Mosman', 'Lane Cove', 'Artarmon', 'Willoughby', 'Hornsby', 'Gordon']],
  ['Western Sydney', ['Blacktown', 'Penrith', 'Westmead', 'Lidcombe', 'Auburn', 'Strathfield', 'Homebush', 'Burwood', 'Rhodes', 'Wentworth Point']],
  ['South West Sydney', ['Bankstown', 'Fairfield', 'Canley Heights', 'Campbelltown']],
  ['Southern Sydney', ['Hurstville', 'Kogarah', 'Rockdale', 'Cronulla', 'Sutherland']],
  ['CBD & Inner City', ['Sydney', 'Zetland', 'Rosebery', 'Erskineville', 'Ultimo', 'Darlington', 'Camperdown']],
  ['Eastern Suburbs', ['Bondi', 'Kensington', 'Kingsford', 'Woollahra', 'Darling Point']]
]) for (const suburb of suburbs) locationRules.push({ suburb, area, match: new RegExp(`\\b${suburb.replaceAll(' ', '\\s+')}\\b`, 'i') });

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return '';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) || !host.includes('.') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}
function publisherUrl(value) {
  let url = publicUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  if (/(^|\.)bing\.com$/.test(parsed.hostname) && parsed.pathname.includes('apiclick')) {
    url = publicUrl(parsed.searchParams.get('url'));
  }
  return url;
}
function privateAddress(ip) {
  if (ip.includes(':')) return !/^2[0-9a-f]{3}:/i.test(ip); // Only global IPv6 unicast.
  const [a,b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
async function fetchText(input) {
  let url = publisherUrl(input);
  const signal = AbortSignal.timeout(12_000);
  for (let redirect = 0; redirect < 5; redirect++) {
    if (!url) throw new Error('invalid_public_url');
    const host = new URL(url).hostname;
    if (blockedHosts.has(host)) throw new Error('host_rate_limited');
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({address}) => privateAddress(address))) throw new Error('non_public_host');
    const response = await fetch(url, { signal, redirect: 'manual', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/rss+xml,application/atom+xml,application/json;q=0.9,*/*;q=0.5' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      url = location ? publicUrl(new URL(location, url).href) : '';
      continue;
    }
    if (!response.ok) {
      if (response.status === 429) blockedHosts.add(host);
      await response.body?.cancel();
      throw new Error(`HTTP_${response.status}`);
    }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new Error('page_too_large'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return { url, text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('too_many_redirects');
}
let requestPage = fetchText;
async function cachedPage(url) {
  const key = publisherUrl(url);
  if (!pageCache.has(key)) pageCache.set(key, requestPage(key));
  return pageCache.get(key);
}
function sourceKind(url) {
  const host = new URL(url).hostname;
  if (/(^|\.)tiktok\.com$/.test(host)) return 'TikTok';
  if (/(^|\.)instagram\.com$/.test(host)) return 'Instagram';
  if (/(^|\.)facebook\.com$/.test(host)) return 'Facebook';
  if (/(^|\.)reddit\.com$/.test(host)) return 'Reddit';
  return 'Public web';
}
function parseFeed(xml, source) {
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error('not_a_feed');
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].flatMap(([, , block]) => {
    const url = publisherUrl(xmlTag(block, 'link') || block.match(/<link\b[^>]*href=["']([^"']+)/i)?.[1]);
    const title = cleanText(xmlTag(block, 'title'));
    if (!url || !title) return [];
    return [{title, url, description: cleanText(xmlTag(block, 'description') || xmlTag(block, 'summary') || xmlTag(block, 'content')),
      publishedAt: xmlTag(block, 'pubDate') || xmlTag(block, 'published') || xmlTag(block, 'updated') || null,
      source: xmlTag(block, 'source') || source, kind: sourceKind(url)}];
  }).slice(0, 15);
}
const webQueries = [
  'site:tiktok.com Sydney restaurant viral', 'site:tiktok.com Sydney food "address"',
  'site:instagram.com Sydney restaurant "address"', 'site:instagram.com Sydney food viral',
  'site:facebook.com Sydney restaurant viral', 'site:facebook.com Sydney food "address"',
  'Sydney viral restaurant address', 'Sydney new restaurant address'
];
const newsQueries = ['Sydney viral restaurant', 'Sydney restaurant opening', 'Sydney food blogger restaurant'];
function searchFeed(query) { return `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`; }
function makeFeeds() {
  return [
    {url:'https://www.broadsheet.com.au/sydney/food-and-drink',source:'Broadsheet current Sydney coverage',publisherIndex:true},
    ...webQueries.map(query => ({url:searchFeed(query), source:`Web search: ${query}`,expectedHost:query.match(/site:([^ ]+)/)?.[1]})),
    ...newsQueries.map(query => ({url:`https://www.bing.com/news/search?format=rss&mkt=en-AU&q=${encodeURIComponent(query)}`,source:'Bing News'})),
    {url:'https://www.reddit.com/r/foodies_sydney/new.rss', source:'Reddit r/foodies_sydney'},
    {url:'https://www.reddit.com/r/sydney/search.rss?q=restaurant&restrict_sr=on&sort=new&t=month', source:'Reddit r/sydney'},
    ...(process.env.DISCOVERY_FEED_URLS || '').split(',').filter(Boolean).map(url=>({url:url.trim(),source:'Configured public feed'}))
  ];
}
async function batches(items, worker, concurrency = 3) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(items.length,concurrency)}, async()=>{
    while(next < items.length) { const i=next++; out[i]=await worker(items[i]); }
  }));
  return out;
}
function recent(date, now) {
  if (!date) return true; // Indexed social results often have no date: keep status explicitly unknown.
  const time=Date.parse(date);
  return Number.isFinite(time) && time <= now + 86400000 && time >= now-LOOKBACK_DAYS*86400000;
}
function validName(value) {
  if (typeof value !== 'string') return '';
  const name=decode(value).replace(/^[📍\s]+|[\s,;:]+$/gu,'').trim();
  if (/^(?:coming soon:|first look:)|\b(?:what we covered|what.s on|you might|opening soon)\b/i.test(name)) return '';
  if (name.length<2 || name.length>70 || !/\p{L}/u.test(name) || /https?:|[<>#?!]|\b(best|top \d+|restaurants|must try|where to|click here|sign in|log in|sydney food|new restaurant)\b/i.test(name)) return '';
  return name;
}
function titleName(title) {
  if(/\b(?:chef|credentialled)\b/i.test(title)) return '';
  const clean=title.replace(/\s+[|–—]\s+(TikTok|Instagram|Facebook|Broadsheet|Time Out).*$/i,'');
  for (const pattern of [
    /^(?:now open|just opened|new opening|introducing)\s*:\s*([^,|–—]+)/i,
    /^(.{2,70}?)\s+(?:opens|has opened|is opening|lands|arrives)\b/i,
    /\b(?:restaurant|cafe|bakery|eatery)\s+(?:named|called)\s+["“]?([^"”.,!]+)/i,
    /📍\s*([^\n,|–—]+?)(?=\s*[,|–—]|\s+\d|$)/u,
    /^(.*?)\s+(?:review|menu)\s*(?:[|–—-]|$)/i
  ]) { const m=clean.match(pattern); if(m) {const name=validName(m[1]); if(name) return name;} }
  return '';
}
function addressInfos(value) {
  if(typeof value!=='string') return [];
  // Match street and locality together, not a suburb mentioned elsewhere on the page.
  const text=decode(value).replace(/[–—]/g,'-');
  if(/\b(?:VIC|QLD|WA|SA|TAS|NT|ACT|Victoria|Queensland|Tasmania)\b/.test(text)) return [];
  const street=/\b(?:shop\s+[\w/-]+\s*,?\s*)?(?:level\s+\d+\s*,?\s*)?\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?\s+[\p{L}’'&.-]+(?:\s+[\p{L}’'&.-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|place|pl|parade|pde|drive|dr|way|crescent|cres|highway|hwy|esplanade)\b/giu;
  const found=[];
  for(const m of text.matchAll(street)) {
    const tail=text.slice(m.index+m[0].length,m.index+m[0].length+90);
    const location=locationRules.find(r=>new RegExp(`^[\\s,]+${r.suburb.replaceAll(' ','\\s+')}\\b`,'i').test(tail));
    if(location) found.push({address:`${m[0].replace(/\s+/g,' ').trim()}, ${location.suburb}, NSW`, suburb:location.suburb, area:location.area});
  }
  return uniqueBy(found,v=>normaliseAddress(v.address));
}
function addressInfo(value) { const found=addressInfos(value); return found.length===1?found[0]:null; }
function structuredVenues(html) {
  const found=[];
  function visit(node) {
    if(!node || typeof node!=='object') return;
    if(Array.isArray(node)) {node.forEach(visit);return;}
    const types=[node['@type']].flat();
    if(types.some(t=>/^(?:https?:\/\/schema.org\/)?(?:Restaurant|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|FastFoodRestaurant)$/i.test(t))) {
      const name=validName(node.name);
      const a=node.address;
      const address=typeof a==='string'?a:[a?.streetAddress,a?.addressLocality,a?.addressRegion,a?.postalCode].filter(Boolean).join(', ');
      const info=addressInfo(address);
      if(name) found.push({name,...(info||{}),text:[node.description,node.servesCuisine].flat().filter(v=>typeof v==='string').join(' '),jsonLd:node});
    }
    Object.values(node).forEach(visit);
  }
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try{visit(JSON.parse(m[1]));}catch{reject('invalid_json_ld');}
  }
  return found;
}
function articleData(html) {
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const queue=[JSON.parse(m[1])];
      while(queue.length){const n=queue.shift();if(!n||typeof n!=='object')continue;
        if([n['@type']].flat().some(t=>/^(Article|NewsArticle|BlogPosting)$/.test(t))) return n;
        queue.push(...Object.values(n).filter(v=>typeof v==='object'));
      }
    }catch{}
  }
  return null;
}
function directPublisherItems(html, source) {
  const items=[];
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;try{url=publicUrl(new URL(decode(m[1]),source.url).href);}catch{continue;}
    if(!url || new URL(url).hostname!==new URL(source.url).hostname || !new URL(url).pathname.startsWith('/sydney/food-and-drink/article/')) continue;
    const title=cleanText(m[2]);
    if(!/\b(restaurant|restaurants|cafe|cafes|bakery|bakeries|bar|bars|hotel|opening|opens|sandwich|sandwiches|first look)\b/i.test(title)) continue;
    if(/\b(recipe|cook at home|coming soon|slated to open)\b/i.test(title)) continue;
    items.push({url,title,description:'',source:source.source,kind:'Public web',publishedAt:null,directPublisher:true});
  }
  return uniqueBy(items,v=>v.url).slice(0,25);
}
function relevantItems(items, feed) {
  if(feed.expectedHost) {
    const onPlatform=[];
    const crossPlatform=[];
    for(const item of items) {
      const host=new URL(item.url).hostname;
      const expected=host===feed.expectedHost || host.endsWith('.'+feed.expectedHost);
      if(expected) {
        onPlatform.push(item);
        continue;
      }
      const text=`${item.title} ${item.description}`;
      const relevant=/\b(restaurant|cafe|bakery|eatery|dining|food|menu)\b/i.test(text) &&
        !/(^|\.)(wikipedia.org|sydney.com)$/.test(host);
      if(relevant) {
        crossPlatform.push(item);
        stats.crossPlatformResults++;
      } else {
        reject('irrelevant_search_result',item.url);
      }
    }
    // Prefer the requested platform, while retaining useful results from other sites.
    return [...onPlatform,...crossPlatform];
  }
  if(feed.source.startsWith('Web search:')) return items.filter(item=>{
    const text=`${item.title} ${item.description}`;
    return /\b(restaurant|cafe|bakery|eatery|dining|food|menu)\b/i.test(text) && !/(^|\.)(wikipedia.org|sydney.com)$/.test(new URL(item.url).hostname);
  });
  return items;
}
function addressBlockVenues(html) {
  const article=articleData(html);
  const paragraphs=[...html.replace(/<script[\s\S]*?<\/script>/gi,'').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1]);
  const found=[];
  for(let i=0;i<paragraphs.length;i++) {
    const lines=paragraphs[i].split(/<br\s*\/?\s*>/i).map(cleanText).filter(Boolean);
    let name='',info=null;
    if(lines.length>1){name=validName(lines[0]);info=addressInfo(lines.slice(1).join(', '));}
    if(!info && /^\s*<(?:strong|b)\b/i.test(paragraphs[i]) && cleanText(paragraphs[i]).length<75) {
      name=validName(cleanText(paragraphs[i]));info=addressInfo(cleanText(paragraphs[i+1]||''));
    }
    if(!name||!info)continue;
    if(article?.articleBody && (!normaliseName(article.articleBody).includes(normaliseName(name)) || !normaliseAddress(article.articleBody).includes(normaliseAddress(info.address.split(',')[0]))))continue;
    found.push({name,...info,text:article?.articleBody||lines.join(' ')});
  }
  return uniqueBy(found,venueKey);
}

function extractVenues(html, item) {
  const addressBlocks=addressBlockVenues(html);
  if(addressBlocks.length)return addressBlocks;
  const structured=structuredVenues(html);
  if(structured.length) return structured;
  const meta=htmlMeta(html,'og:description') || htmlMeta(html,'description');
  const title=htmlMeta(html,'og:title') || item.title;
  const text=cleanText(html);
  const found=[];
  // Captions with explicit "Restaurant:" or a location pin bind the name to its address.
  const snippets=[item.description,meta,...html.split(/<h[23]\b[^>]*>/i).slice(1).map(s=>s.split(/<h[123]\b/i)[0])].filter(Boolean);
  for(const snippet of snippets) {
    const plain=cleanText(snippet);
    const pin=plain.match(/(?:📍|Restaurant\s*:)\s*([^,|\n]+?)(?=\s*[,|]|\s+\d)/iu);
    const heading=snippet.match(/^([^<]{2,70})<\/h[23]>/i)?.[1];
    const name=validName(pin?.[1]||heading||'');
    const info=addressInfo(plain);
    if(name&&info) found.push({name,...info,text:plain});
  }
  if(found.length) return found;
  const name=titleName(title)||titleName(item.title)||titleName(meta);
  if(!name) return [];
  // For unstructured articles use only a single unambiguous address.
  const addresses=uniqueBy([meta,item.description,text].map(addressInfo).filter(Boolean),v=>normaliseAddress(v.address));
  return [{name,...(addresses.length===1?addresses[0]:{}),text:meta||item.description||''}];
}
function publishedPrice(text,url,now) {
  // No invented per-person estimates from unrelated menu dollar amounts.
  const m=text.match(/\$\s*(\d{1,3})(?:\s*[-–]\s*\$?\s*(\d{1,3}))?\s*(?:pp\b|per person\b|per head\b)/i);
  if(!m) return null;
  const min=Number(m[1]),max=Number(m[2]||m[1]);
  if(min<=0||max<min||max>1000) return null;
  return {currency:'AUD',min,max,label:min===max?`$${min} pp`:`$${min}–$${max} pp`,basis:'Published per-person price',confidence:'high',sourceUrl:url,lastVerifiedAt:now};
}
async function readStory(item) {
  // Google News RSS links are often HTML wrappers, not HTTP redirects to the article.
  if(new URL(item.url).hostname==='news.google.com') {
    try {
      const {text}=await cachedPage(searchFeed(`"${item.title}"`));
      const alternatives=parseFeed(text,'Publisher lookup').filter(r=>!/(^|\.)google\.com$/.test(new URL(r.url).hostname));
      const tokens=normaliseName(item.title).split(' ').filter(t=>t.length>3);
      const match=alternatives.find(r=>tokens.length && tokens.filter(t=>normaliseName(r.title).includes(t)).length/tokens.length>=0.75);
      if(!match) {reject('publisher_link_unresolved',item.url);return null;}
      item={...item,url:match.url,kind:sourceKind(match.url)};
    }catch(e){reject(`publisher_lookup_${e.message}`,item.url);return null;}
  }
  try {
    if(item.kind==='TikTok' && /\/video\/\d+/.test(item.url)) {
      const {text}=await cachedPage(`https://www.tiktok.com/oembed?url=${encodeURIComponent(item.url)}`);
      const embed=JSON.parse(text);
      return {item,html:embed.html||'',description:embed.title||''};
    }
    const page=await cachedPage(item.url);
    if(/<title[^>]*>[^<]*(?:log in|login|sign in|just a moment)/i.test(page.text)) {
      reject('login_or_challenge',item.url);return null;
    }
    return {item:{...item,url:page.url,kind:sourceKind(page.url)},html:page.text};
  }catch(e){reject(`page_${e.message}`,item.url);return null;}
}
async function detailLookup(candidate) {
  if(stats.detailLookups>=MAX_LOOKUPS) {reject('detail_lookup_budget',candidate.name);return candidate;}
  stats.detailLookups++;
  const query=`"${candidate.name}" ${candidate.suburb||'Sydney'} restaurant address menu`;
  try {
    const {text}=await cachedPage(searchFeed(query));
    const results=parseFeed(text,'Venue lookup').filter(r=>normaliseName(`${r.title} ${r.description}`).includes(normaliseName(candidate.name)));
    for(const result of results.slice(0,3)) {
      // Enrich from venue/publisher pages, not Google Maps' undocumented HTML.
      if(/(^|\.)(google\.com|google\.com\.au)$/.test(new URL(result.url).hostname)) continue;
      const story=await readStory(result); if(!story) continue;
      const options=extractVenues(story.html,{...result,description:story.description||result.description});
      const snippetInfo=addressInfo(result.description);
      if(!options.length && snippetInfo && normaliseName(result.title).startsWith(normaliseName(candidate.name)+' ')) {
        options.push({name:candidate.name,...snippetInfo,text:result.description});
      }
      // Exact normalized name; never take an unrelated restaurant's address.
      const matches=options.filter(v=>normaliseName(v.name)===normaliseName(candidate.name)&&v.address);
      if(matches.length!==1) continue;
      const match=matches[0];
      if(candidate.address && normaliseAddress(candidate.address)!==normaliseAddress(match.address)) continue;
      return {...candidate,...match,text:match.text||candidate.text,detailSource:story.item.url};
    }
  }catch(e){reject(`detail_${e.message}`,candidate.name);}
  return candidate;
}
let lastGeocode=0;
async function geocode(candidate) {
  if(process.env.SKIP_GEOCODE==='true') return null;
  const delay=1100-(Date.now()-lastGeocode); if(delay>0) await new Promise(r=>setTimeout(r,delay));
  lastGeocode=Date.now();
  try {
    const params=new URLSearchParams({q:candidate.address,format:'jsonv2',addressdetails:'1',countrycodes:'au',limit:'3',bounded:'1',viewbox:'150.4,-33.3,151.6,-34.5'});
    const {text}=await requestPage(`https://nominatim.openstreetmap.org/search?${params}`);
    const results=JSON.parse(text);
    const streetNumber=candidate.address.match(/\b\d+[a-z]?(?:[-/]\d+[a-z]?)?\s+/i)?.[0].trim();
    const match=results.find(r=>r.address?.country_code==='au' && r.address?.house_number===streetNumber &&
      r.address?.road && normaliseAddress(candidate.address).includes(normaliseAddress(r.address.road)) &&
      Number(r.lat)>=-34.5&&Number(r.lat)<=-33.3&&Number(r.lon)>=150.4&&Number(r.lon)<=151.6);
    return match?[Number(match.lat),Number(match.lon)]:null;
  }catch(e){reject(`geocode_${e.message}`,candidate.name);return null;}
}
function venueKey(v) {return `${normaliseName(v.name)}|${normaliseAddress(v.address)}`;}
function makeProfile(candidate,id,now,coordinates) {
  const cuisine=inferCuisine(candidate.text||'')||'Unknown';
  const detailSource=candidate.detailSource||candidate.item.url;
  return {id,name:candidate.name,address:candidate.address,suburb:candidate.suburb,area:candidate.area,
    googleMapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${candidate.name}, ${candidate.address}`)}`,
    coordinates,cuisine,pricePerPerson:publishedPrice(candidate.text||'',detailSource,now),
    trend:['TikTok','Instagram','Facebook','Reddit'].includes(candidate.item.kind)?'Social mention':'Recently discovered',
    summary:`${candidate.name} was discovered through ${candidate.item.kind} coverage. See the linked source for details.`,
    cons:'Not yet verified.',menuHighlights:[],comments:[],themes:[candidate.item.kind,candidate.suburb],
    dietary:{vegetarian:null,vegan:null,glutenFree:null,dairyFree:null,chickenAvailable:null,confidence:'Not verified'},
    source:candidate.item.url,latestNews:[{title:candidate.item.title,url:candidate.item.url,source:candidate.item.source,publishedAt:candidate.item.publishedAt}],
    discovery:{foundAt:now,publishedAt:candidate.item.publishedAt||null,dateStatus:candidate.item.publishedAt?'published date available':'publication date unknown',
      signal:'Public mention; virality not independently measured',detailSource},
    updatedAt:now};
}
async function main({request = fetchText} = {}) {
  requestPage = request;
  pageCache.clear(); blockedHosts.clear();
  Object.assign(stats,{feeds:[],pagesAttempted:0,rejected:{},accepted:0,duplicates:0,detailLookups:0,crossPlatformResults:0});
  const original=await readFile(DATABASE_PATH,'utf8');
  const database=JSON.parse(original);
  if(!Array.isArray(database?.restaurants)||database.restaurants.some(r=>!r||typeof r.name!=='string'||typeof r.address!=='string')) throw new Error('Invalid restaurant database; refusing to write.');
  const now=new Date().toISOString();
  const feeds=SKIP_FETCH?[]:makeFeeds();
  const results=await batches(feeds,async feed=>{
    try {
      const {text}=await cachedPage(feed.url);
      const raw=feed.publisherIndex?directPublisherItems(text,feed):parseFeed(text,feed.source);
      const items=relevantItems(raw,feed);
      stats.feeds.push({source:feed.source,status:raw.length&&!items.length?'irrelevant_results':'ok',returned:raw.length,items:items.length});return items;
    }
    catch(e){stats.feeds.push({source:feed.source,status:e.message,items:0});reject(`feed_${e.message}`,feed.url);return [];}
  });
  // Round-robin avoids one news provider consuming the whole daily budget.
  const interleaved=[];
  for(let i=0;i<25;i++) for(const items of results) if(items[i]) interleaved.push(items[i]);
  const news=uniqueBy(interleaved,v=>v.url).filter(item=>{if(recent(item.publishedAt,Date.parse(now))) return true;reject('outside_lookback',item.url);return false;}).slice(0,MAX_PAGES);
  const extracted=(await batches(news,async item=>{
    stats.pagesAttempted++;
    const story=await readStory(item);
    // An indexed snippet remains usable evidence when the public page cannot be fetched.
    const effective=story?{...story.item,description:story.description||item.description}:item;
    const article=articleData(story?.html||'');
    if(article?.datePublished) effective.publishedAt=article.datePublished;
    if(!recent(effective.publishedAt,Date.parse(now))) {reject('article_outside_lookback',item.url);return [];}
    if(effective.directPublisher && !effective.publishedAt) {reject('publisher_date_missing',item.url);return [];}
    const candidates=extractVenues(story?.html||'',effective);
    if(!candidates.length) reject('no_identifiable_name',item.url);
    return candidates.map(v=>({...v,item:effective}));
  })).flat();
  const known=new Set(database.restaurants.map(venueKey));
  const additions=[];
  let nextId=database.restaurants.reduce((n,r)=>Math.max(n,Number.isSafeInteger(Number(r.id))?Number(r.id):0),0)+1;
  const seen=new Set();
  for(let candidate of extracted) {
    if(additions.length>=MAX_NEW) {reject('daily_addition_limit');break;}
    const initialKey=venueKey(candidate);
    if(known.has(initialKey)||seen.has(initialKey)){if(candidate.address)stats.duplicates++;else reject('repeated_unresolved_name',candidate.name);continue;}
    seen.add(initialKey);
    if(!candidate.address||!inferCuisine(candidate.text||'')||!publishedPrice(candidate.text||'',candidate.item.url,now)) candidate=await detailLookup(candidate);
    if(!candidate.address){reject('missing_sydney_street_address',candidate.name);continue;}
    if(known.has(venueKey(candidate))){stats.duplicates++;continue;}
    const coordinates=await geocode(candidate);
    if(!coordinates) reject('coordinates_unavailable_optional',candidate.name);
    const profile=makeProfile(candidate,nextId++,now,coordinates);
    additions.push(profile);known.add(venueKey(candidate));
    console.log(`[accepted] ${candidate.name} | ${candidate.address}`);
  }
  stats.accepted=additions.length;
  if(!DRY_RUN&&additions.length) {
    // Do not overwrite edits made since the run started.
    if(await readFile(DATABASE_PATH,'utf8')!==original) throw new Error('Database changed during discovery; refusing to overwrite.');
    const updated={...database,updatedAt:now,restaurants:[...database.restaurants,...additions]};
    const temp=`${DATABASE_PATH}.${process.pid}.tmp`;
    await writeFile(temp,`${JSON.stringify(updated,null,2)}\n`);
    await rename(temp,DATABASE_PATH);
  }
  const summary={message:DRY_RUN?'Dry run':additions.length?'New restaurants appended':'No additions; database unchanged',totalProfiles:database.restaurants.length+additions.length,addedProfiles:additions.length,scannedNewsItems:news.length,enrichedCandidates:extracted.length,...stats};
  console.log(JSON.stringify(summary,null,2));
  if(process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,`### Restaurant discovery\n\n\`\`\`json\n${JSON.stringify(summary,null,2)}\n\`\`\`\n`,{flag:'a'});
  if(feeds.length && stats.feeds.every(f=>f.status!=='ok')) throw new Error('All discovery sources failed; see feed diagnostics.');
  if(feeds.length && !additions.length && !stats.duplicates) throw new Error('Discovery ineffective: no usable restaurant identities. Inspect source/rejection diagnostics; this is not a successful search.');
}
export { directPublisherItems, relevantItems, addressBlockVenues, addressInfo, titleName, extractVenues, parseFeed, publisherUrl, venueKey, makeProfile, recent, main };
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(e=>{console.error(e);process.exitCode=1;});
