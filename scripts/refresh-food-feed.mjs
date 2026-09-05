import { readFile, rename, writeFile } from 'node:fs/promises';

const DATABASE_PATH =
  process.env.DATABASE_PATH || 'dist/data/restaurant-database.json';

const TEMP_DATABASE_PATH = `${DATABASE_PATH}.tmp`;

const USER_AGENT =
  'SydneyFoodPulse/3.0 (https://github.com/michaelryo/sydney-food-pulse)';

const LOOKBACK = '14d';
const MAX_RESULTS_PER_SEARCH = 8;
const MAX_PAGES_TO_ENRICH = 120;
const MAX_NEW_RESTAURANTS_PER_RUN = 10;
const MIN_NEW_SIGNAL_SCORE = 4;
const FETCH_TIMEOUT_MS = 15_000;
const GEOCODE_DELAY_MS = 1_100;

const DRY_RUN = process.env.DRY_RUN === 'true';
const SKIP_FETCH = process.env.SKIP_FETCH === 'true';

const searches = [
  { query: 'Sydney restaurant opening', topic: 'New opening', weight: 3 },
  { query: 'Sydney restaurant just opened', topic: 'New opening', weight: 3 },
  { query: 'Sydney new restaurant review', topic: 'Review', weight: 3 },
  { query: 'Sydney best new restaurant', topic: 'Editors pick', weight: 3 },
  { query: 'Sydney food viral restaurant', topic: 'Social buzz', weight: 2 },
  { query: 'Sydney restaurant TikTok viral', topic: 'TikTok signal', weight: 2 },
  { query: 'Sydney restaurant Instagram viral', topic: 'Instagram signal', weight: 2 },
  { query: 'Sydney restaurant food blogger', topic: 'Creator signal', weight: 2 },
  { query: 'Sydney cheap eats new restaurant', topic: 'Cheap eat', weight: 3 },
  { query: 'Sydney restaurant under $30', topic: 'Cheap eat', weight: 2 },
  { query: 'Sydney bakery cafe viral', topic: 'Social buzz', weight: 2 },
  { query: 'Sydney dessert shop viral', topic: 'Social buzz', weight: 2 },
  { query: 'Sydney CBD restaurant opening', topic: 'CBD opening', weight: 3 },
  { query: 'Sydney Inner West restaurant opening', topic: 'Inner West opening', weight: 3 },
  { query: 'Sydney Eastern Suburbs restaurant opening', topic: 'Eastern Suburbs opening', weight: 3 },
  { query: 'Sydney Northern Beaches restaurant opening', topic: 'Northern Beaches opening', weight: 3 },
  { query: 'Sydney Western Suburbs restaurant opening', topic: 'Western Sydney opening', weight: 3 },
  { query: 'Sydney South West restaurant opening', topic: 'South West opening', weight: 3 },
  { query: 'Sydney North Shore restaurant opening', topic: 'North Shore opening', weight: 3 },
  {
    query: 'site:broadsheet.com.au/sydney/food-and-drink Sydney restaurant',
    topic: 'Broadsheet',
    weight: 3
  },
  {
    query: 'site:concreteplayground.com/sydney Sydney restaurant',
    topic: 'Concrete Playground',
    weight: 3
  },
  { query: 'site:goodfood.com.au Sydney restaurant', topic: 'Good Food', weight: 3 },
  { query: 'site:timeout.com/sydney Sydney restaurant', topic: 'Time Out', weight: 3 },
  { query: 'site:theurbanlist.com Sydney restaurant', topic: 'Urban List', weight: 3 },
  {
    query: 'site:gourmettraveller.com.au Sydney restaurant',
    topic: 'Gourmet Traveller',
    weight: 3
  },
  {
    query: 'site:notquitenigella.com Sydney restaurant',
    topic: 'Not Quite Nigella',
    weight: 3
  },
  { query: 'site:sitchu.com.au Sydney restaurant', topic: 'Sitchu', weight: 2 }
];

const communityFeeds = [
  {
    url:
      'https://www.reddit.com/r/sydney/search.rss?' +
      'q=restaurant&restrict_sr=on&sort=new&t=week',
    source: 'Reddit r/sydney',
    topic: 'Community signal',
    weight: 1
  },
  {
    url:
      'https://www.reddit.com/r/foodies_sydney/search.rss?' +
      'q=restaurant&restrict_sr=on&sort=new&t=week',
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

/*
 * These coordinates identify general regions only.
 * They are never used as restaurant coordinates.
 */
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
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(parseInt(number, 16))
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
    .replace(/\b\d{4}\b/g, ' ')
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml,' +
        'application/rss+xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    url: response.url,
    text: (await response.text()).slice(0, 2_000_000)
  };
}

function rssItems(xml, defaults) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1];

      return {
        title: xmlTag(block, 'title'),
        url: xmlTag(block, 'link'),
        source: xmlTag(block, 'source') || defaults.source,
        publishedAt: xmlTag(block, 'pubDate'),
        topic: defaults.topic,
        weight: defaults.weight
      };
    })
    .filter((item) => item.title && item.url)
    .slice(0, MAX_RESULTS_PER_SEARCH);
}

async function googleNewsSearch(search) {
  const query = encodeURIComponent(`${search.query} when:${LOOKBACK}`);
  const url =
    `https://news.google.com/rss/search?q=${query}` +
    '&hl=en-AU&gl=AU&ceid=AU:en';

  const { text } = await fetchText(url);
  return rssItems(text, { ...search, source: 'Google News' });
}

async function bingNewsSearch(search) {
  const query = encodeURIComponent(search.query);
  const url =
    `https://www.bing.com/news/search?q=${query}` +
    '&format=rss&mkt=en-AU';

  const { text } = await fetchText(url);
  return rssItems(text, { ...search, source: 'Bing News' });
}

async function readCommunityFeed({ url, source, topic, weight }) {
  const { text } = await fetchText(url);

  return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)]
    .map((match) => {
      const block = match[1];
      const href =
        block.match(/<link[^>]+href="([^"]+)"/i)?.[1] ||
        xmlTag(block, 'link');

      return {
        title: xmlTag(block, 'title'),
        url: decode(href),
        source,
        publishedAt:
          xmlTag(block, 'updated') || xmlTag(block, 'published'),
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
        console.warn(
          `Skipped ${current.url || current.query}: ${error.message}`
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length || 1) },
      run
    )
  );

  return output;
}

function findJsonLdRestaurant(html) {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];

  function visit(node) {
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }

    const types = Array.isArray(node['@type'])
      ? node['@type']
      : [node['@type']];

    const isRestaurant = types.some((type) =>
      /restaurant|foodestablishment|cafeorcoffeeshop|bakery/i.test(
        String(type)
      )
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
      // Parse raw JSON first: HTML decoding can corrupt valid JSON.
      const restaurant = visit(JSON.parse(script[1].trim()));
      if (restaurant) return restaurant;
    } catch {
      // Ignore invalid JSON-LD and continue.
    }
  }

  return null;
}

function extractRestaurantName(title, jsonLd) {
  if (jsonLd?.name && jsonLd.name.length < 80) {
    return truncate(jsonLd.name, 70);
  }

  const clean = title
    .replace(/\s+\|\s+[^|]+$/, '')
    .replace(
      /\s+-\s+(Broadsheet|Time Out|Good Food|Concrete Playground|The Urban List|Gourmet Traveller).*$/i,
      ''
    )
    .trim();

  const patterns = [
    /^(?:just\s+)?(?:opened|opening now|new)\s*:\s*([^,|–—]{2,70})/i,
    /^([^|–—]{2,70}?)\s+(?:opens|opened|is opening|lands|arrives|brings|hits|returns)\b/i,
    /\b(?:restaurant|bar|bistro|cafe|café|trattoria|pizzeria|bakery|taqueria)\s+(?:called|named)?\s*[“"']?([A-Z][\w’'&+.-]*(?:\s+[A-Z][\w’'&+.-]*){0,4})/i,
    /\bintroducing\s+([A-Z][\w’'&+.-]*(?:\s+[A-Z][\w’'&+.-]*){0,4})/i
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
      !/^(sydney|new restaurant|a restaurant|the restaurant|best restaurants?|where to eat)$/i.test(candidate)
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

    if (parts.length >= 2) {
      return parts.join(', ').replace(/\s+/g, ' ').trim();
    }
  }

  if (typeof address === 'string' && address.length > 10) {
    return address.trim();
  }

  const match = text.match(
    /\b(?:level\s*\d+[,]?\s*)?(?:shop\s*[a-z0-9/-]+[,]?\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?\s+[\w’'&.-]+(?:\s+[\w’'&.-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|place|pl|esplanade|parade|pde|drive|dr|way)\b[^.]{0,70}/i
  );

  return match
    ? match[0].replace(/\s+/g, ' ').replace(/[;,]+$/, '').trim()
    : '';
}

function resolveLocation(address, pageText) {
  const addressMatch = locationRules.find((entry) =>
    entry.match.test(address)
  );
  if (addressMatch) return addressMatch;

  const pageMatch = locationRules.find((entry) =>
    entry.match.test(pageText)
  );
  if (pageMatch) return pageMatch;

  if (/\bSydney\s+NSW\s+2000\b/i.test(address)) {
    return locationRules.find((entry) => entry.suburb === 'Sydney CBD');
  }

  return null;
}

function formatAddress(address, location) {
  if (!address || !location) return '';

  const compact = address.replace(/[,. ]+$/, '');
  const hasSuburb = new RegExp(
    `\\b${location.suburb.replace(/ /g, '\\s+')}\\b`,
    'i'
  ).test(compact);
  const hasState = /\bNSW\b|\bNew South Wales\b/i.test(compact);

  return [
    compact,
    hasSuburb ? '' : location.suburb,
    hasState ? '' : 'NSW'
  ].filter(Boolean).join(', ');
}

function inferCuisine(text) {
  return cuisineRules.find((rule) => rule.match.test(text))?.value || '';
}

function extractPricePerPerson(text, sourceUrl, checkedAt) {
  const direct = [
    ...text.matchAll(
      /\$\s?(\d{1,3}(?:\.\d{1,2})?)\s*(?:pp|p\.?p\.?|per person|per head)/gi
    )
  ]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 10 && value <= 500);

  if (direct.length) {
    const min = Math.min(...direct);
    const max = Math.max(...direct);

    return {
      currency: 'AUD',
      min,
      max,
      label: min === max ? `$${min} pp` : `$${min}-$${max} pp`,
      basis: 'Published per-person or per-head price',
      confidence: 'high',
      sourceUrl,
      lastVerifiedAt: checkedAt
    };
  }

  const explicitRange = text.match(
    /\$\s?(\d{1,3})\s*(?:-|–|to)\s*\$?\s?(\d{1,3})/
  );

  if (explicitRange) {
    const min = Number(explicitRange[1]);
    const max = Number(explicitRange[2]);

    if (min >= 8 && max <= 300 && min < max) {
      return {
        currency: 'AUD',
        min,
        max,
        label: `$${min}-$${max} pp`,
        basis: 'Published menu price range',
        confidence: 'high',
        sourceUrl,
        lastVerifiedAt: checkedAt
      };
    }
  }

  const prices = [...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{1,2})?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 8 && value <= 250)
    .sort((a, b) => a - b);

  if (prices.length < 3) return null;

  const minIndex = Math.floor((prices.length - 1) * 0.35);
  const maxIndex = Math.floor((prices.length - 1) * 0.9);
  const min = Math.round(prices[minIndex] / 5) * 5;
  const calculatedMax = Math.round(prices[maxIndex] / 5) * 5;
  const max = Math.max(calculatedMax, min + 5);

  if (min < 10 || max > 300) return null;

  return {
    currency: 'AUD',
    min,
    max,
    label: `$${min}-$${max} pp`,
    basis: 'Estimated from multiple published menu prices; food only',
    confidence: 'medium',
    sourceUrl,
    lastVerifiedAt: checkedAt
  };
}

function extractMenuHighlights(text) {
  const matches = [
    ...text.matchAll(
      /(?:highlights include|menu highlights|standouts include|known for|signature dishes? include|expect|menu features)\s*:?\s*([^.!?]{20,320})/gi
    )
  ];

  const candidates = matches
    .flatMap((match) => match[1].split(/,|;|\band\b/gi))
    .map((value) => truncate(value.replace(/\([^)]*\)/g, ''), 80))
    .filter((value) => value.length >= 4 && value.length <= 80)
    .filter((value) => !/^(the|a|an|with|and|or)$/i.test(value));

  return uniqueBy(candidates, (value) => value.toLowerCase()).slice(0, 5);
}

function extractDietarySignals(text) {
  function signal(positive, negative) {
    if (negative.test(text)) return false;
    if (positive.test(text)) return true;
    return null;
  }

  return {
    vegetarian: signal(
      /\bvegetarian(?: option| menu| friendly)?\b/i,
      /\bno vegetarian options?\b/i
    ),
    vegan: signal(
      /\bvegan(?: option| menu| friendly)?\b/i,
      /\bno vegan options?\b/i
    ),
    glutenFree: signal(
      /\bgluten[- ]free(?: option| menu| friendly)?\b/i,
      /\bno gluten[- ]free options?\b/i
    ),
    dairyFree: signal(
      /\bdairy[- ]free(?: option| menu| friendly)?\b/i,
      /\bno dairy[- ]free options?\b/i
    ),
    chickenAvailable: signal(/\bchicken\b/i, /\bno chicken\b/i),
    confidence: 'Public page text signal; confirm with venue for allergies'
  };
}

function extractCons(text) {
  const sentences = text.match(/[^.!?]{20,240}[.!?]/g) || [];
  const warning = sentences.find((sentence) =>
    /\b(queue|wait|book ahead|booked out|small|cramped|limited seating|expensive|pricey|noisy|loud|spicy|cash only|walk-in|sell out|sold out)\b/i.test(sentence)
  );

  return warning
    ? truncate(warning, 220)
    : 'No recurring drawback was confirmed in the retrieved public sources; check current booking and menu details before visiting.';
}

function buildThemes(candidate) {
  const themes = [
    candidate.trend,
    candidate.cuisine,
    candidate.area,
    candidate.source.topic
  ];

  if (candidate.pricePerPerson?.max <= 35) {
    themes.push('cheap eat');
  }

  return uniqueBy(
    themes.filter(Boolean).map((value) => value.toLowerCase()),
    (value) => value
  ).slice(0, 5);
}

function googleMapsUrl(restaurant) {
  const query = [restaurant.name, restaurant.address]
    .filter(Boolean)
    .join(', ');

  return (
    'https://www.google.com/maps/search/' +
    `?api=1&query=${encodeURIComponent(query)}`
  );
}

function newsKey(item) {
  return `${normaliseName(item?.title || '')}|${item?.url || ''}`;
}

function isLikelyRestaurantStory(title, text) {
  return /\b(restaurant|bar|bistro|cafe|café|bakery|trattoria|pizzeria|taqueria|diner|eatery|menu|chef|opening|opens|opened)\b/i.test(
    `${title} ${text.slice(0, 5_000)}`
  );
}

async function enrichNewsItem(item, checkedAt) {
  // Reddit is not used as the sole address or pricing source.
  if (/^Reddit /i.test(item.source)) return null;

  const { url, text: html } = await fetchText(item.url);
  const pageText = cleanText(html);
  const jsonLd = findJsonLdRestaurant(html);
  const pageTitle = htmlMeta(html, 'og:title') || item.title;
  const description =
    htmlMeta(html, 'og:description') || htmlMeta(html, 'description');

  const combined = `${pageTitle}\n${description}\n${pageText}`;

  if (!isLikelyRestaurantStory(pageTitle, combined)) return null;

  const name = extractRestaurantName(pageTitle, jsonLd);
  const rawAddress = extractAddress(combined, jsonLd);
  const location = resolveLocation(rawAddress, combined);
  const address = formatAddress(rawAddress, location);

  const cuisine = inferCuisine(
    `${pageTitle}\n${description}\n${pageText.slice(0, 20_000)}`
  );

  const pricePerPerson = extractPricePerPerson(pageText, url, checkedAt);

  if (!name || !location || !address || !cuisine || !pricePerPerson) {
    return null;
  }

  const source = {
    title: item.title,
    url,
    source: item.source,
    topic: item.topic,
    publishedAt: item.publishedAt || null
  };

  const candidate = {
    name,
    cuisine,
    area: location.area,
    suburb: location.suburb,
    address,
    coordinates: null,
    googleMapsUrl: googleMapsUrl({ name, address }),
    trend:
      item.topic === 'Cheap eat'
        ? 'Cheap eat'
        : item.topic || 'Newly found',
    pricePerPerson,
    summary: truncate(
      description || `${name} was found in recent ${item.source} coverage.`
    ),
    cons: extractCons(pageText),
    menuHighlights: extractMenuHighlights(pageText),
    dietary: extractDietarySignals(pageText),
    comments: [],
    source,
    signalScore:
      (item.weight || 1) + (sourceWeight[item.source] || 1)
  };

  candidate.themes = buildThemes(candidate);
  return candidate;
}

function hasValidCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return false;
  }

  const latitude = Number(coordinates[0]);
  const longitude = Number(coordinates[1]);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -34.5 &&
    latitude <= -33.3 &&
    longitude >= 150.4 &&
    longitude <= 151.6
  );
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let lastGeocodeRequestAt = 0;

async function geocodeQuery(query) {
  const wait = GEOCODE_DELAY_MS - (Date.now() - lastGeocodeRequestAt);
  if (wait > 0) await sleep(wait);

  lastGeocodeRequestAt = Date.now();

  const parameters = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'au',
    limit: '3',
    bounded: '1',
    viewbox: '150.4,-33.3,151.6,-34.5'
  });

  const { text } = await fetchText(
    'https://nominatim.openstreetmap.org/search?' + parameters
  );

  const results = JSON.parse(text);

  const valid = results.filter((result) => {
    const coordinates = [Number(result.lat), Number(result.lon)];
    const country = result.address?.country_code || '';
    const state = result.address?.state || '';

    return (
      hasValidCoordinates(coordinates) &&
      country.toLowerCase() === 'au' &&
      (!state || /new south wales|nsw/i.test(state))
    );
  });

  const preferred =
    valid.find((result) =>
      /restaurant|cafe|fast_food|building|house|commercial/i.test(result.type)
    ) || valid[0];

  if (!preferred) return null;

  return [
    Number(Number(preferred.lat).toFixed(6)),
    Number(Number(preferred.lon).toFixed(6))
  ];
}

async function geocodeRestaurant(restaurant) {
  if (hasValidCoordinates(restaurant.coordinates)) {
    return restaurant.coordinates.map(Number);
  }

  const queries = uniqueBy(
    [
      `${restaurant.name}, ${restaurant.address}`,
      restaurant.address,
      `${restaurant.name}, ${restaurant.suburb}, Sydney NSW Australia`
    ].filter(Boolean),
    (value) => value.toLowerCase()
  );

  for (const query of queries) {
    try {
      const coordinates = await geocodeQuery(query);
      if (coordinates) return coordinates;
    } catch (error) {
      console.warn(
        `Geocoding failed for ${restaurant.name}: ${error.message}`
      );
    }
  }

  return null;
}

function mergeNews(existing = [], incoming = []) {
  return uniqueBy([...incoming, ...existing], newsKey)
    .sort(
      (a, b) =>
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
    )
    .slice(0, 5);
}

function relatedNews(name, allNews) {
  const target = normaliseName(name);
  if (!target) return [];

  return allNews.filter((item) =>
    normaliseName(item.title).includes(target)
  );
}

// Called only for NEW restaurants.
function canonicalRestaurant(restaurant, updatedAt) {
  const output = {
    id: Number(restaurant.id),
    name: restaurant.name,
    cuisine: restaurant.cuisine,
    area: restaurant.area,
    suburb: restaurant.suburb,
    address: restaurant.address,
    googleMapsUrl:
      restaurant.googleMapsUrl || googleMapsUrl(restaurant),
    coordinates: hasValidCoordinates(restaurant.coordinates)
      ? restaurant.coordinates.map(Number)
      : restaurant.coordinates,
    trend: restaurant.trend,
    pricePerPerson: restaurant.pricePerPerson,
    summary: restaurant.summary,
    cons: restaurant.cons,
    menuHighlights: Array.isArray(restaurant.menuHighlights)
      ? restaurant.menuHighlights.slice(0, 5)
      : [],
    dietary: restaurant.dietary || {
      vegetarian: null,
      vegan: null,
      glutenFree: null,
      dairyFree: null,
      chickenAvailable: null,
      confidence: 'Not yet verified'
    },
    themes: Array.isArray(restaurant.themes)
      ? restaurant.themes.slice(0, 5)
      : [],
    comments: Array.isArray(restaurant.comments)
      ? restaurant.comments.slice(0, 5)
      : [],
    source: restaurant.source,
    latestNews: Array.isArray(restaurant.latestNews)
      ? restaurant.latestNews.slice(0, 5)
      : [],
    updatedAt: restaurant.updatedAt || updatedAt
  };

  if (/^https:\/\//i.test(restaurant.tripadvisorReviewUrl || '')) {
    output.tripadvisorReviewUrl = restaurant.tripadvisorReviewUrl;
  }

  if (/^https:\/\//i.test(restaurant.googleReviewUrl || '')) {
    output.googleReviewUrl = restaurant.googleReviewUrl;
  }

  return output;
}

function validateRestaurant(restaurant) {
  const missing = [];

  const requiredStrings = [
    'name',
    'cuisine',
    'area',
    'suburb',
    'address',
    'googleMapsUrl',
    'trend',
    'summary',
    'cons',
    'source',
    'updatedAt'
  ];

  for (const field of requiredStrings) {
    if (
      typeof restaurant[field] !== 'string' ||
      !restaurant[field].trim()
    ) {
      missing.push(field);
    }
  }

  if (!Number.isInteger(restaurant.id) || restaurant.id <= 0) {
    missing.push('id');
  }

  if (!hasValidCoordinates(restaurant.coordinates)) {
    missing.push('coordinates');
  }

  const price = restaurant.pricePerPerson;

  if (
    !price ||
    price.currency !== 'AUD' ||
    !Number.isFinite(price.min) ||
    !Number.isFinite(price.max) ||
    price.min > price.max
  ) {
    missing.push('pricePerPerson');
  }

  if (!Array.isArray(restaurant.latestNews)) {
    missing.push('latestNews');
  }

  return missing;
}

async function main() {
  const updatedAt = new Date().toISOString();
  const database = JSON.parse(await readFile(DATABASE_PATH, 'utf8'));

  // Fail safely instead of treating a malformed database as empty.
  if (
    !database ||
    typeof database !== 'object' ||
    !Array.isArray(database.restaurants) ||
    database.restaurants.some(
      (restaurant) =>
        !restaurant ||
        typeof restaurant !== 'object' ||
        typeof restaurant.name !== 'string' ||
        typeof restaurant.address !== 'string'
    )
  ) {
    throw new Error(
      'Invalid database: expected a restaurants array with names and addresses. No changes written.'
    );
  }

  const [googleResults, bingResults, communityResults] = SKIP_FETCH
    ? [[], [], []]
    : await Promise.all([
        inBatches(searches, googleNewsSearch, 4),
        inBatches(searches, bingNewsSearch, 4),
        inBatches(communityFeeds, readCommunityFeed, 2)
      ]);

  // Apply the date cutoff to every provider, including Bing.
  const allNews = uniqueBy(
    [
      ...googleResults.flat(),
      ...bingResults.flat(),
      ...communityResults.flat()
    ],
    (item) => `${normaliseName(item.title)}|${item.url}`
  )
    .filter((item) => {
      const published = Date.parse(item.publishedAt);
      const now = Date.parse(updatedAt);

      return (
        Number.isFinite(published) &&
        published >= now - 14 * 24 * 60 * 60 * 1000 &&
        published <= now + 24 * 60 * 60 * 1000
      );
    })
    .slice(0, MAX_PAGES_TO_ENRICH);

  if (!allNews.length) {
    console.warn(
      'No news items returned; the existing database will remain unchanged.'
    );
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

  // Keep the original objects. Never refresh or canonicalize them.
  const restaurants = database.restaurants;

  const knownNames = new Set(
    restaurants.map((restaurant) => normaliseName(restaurant.name))
  );

  const knownAddresses = new Set(
    restaurants
      .map((restaurant) => normaliseAddress(restaurant.address))
      .filter(Boolean)
  );

  let nextId =
    Math.max(
      0,
      ...restaurants.map((restaurant) => Number(restaurant.id) || 0)
    ) + 1;

  let added = 0;
  const newRestaurants = [];

  const orderedCandidates = [...candidatesByName.values()].sort(
    (a, b) => b.signalScore - a.signalScore
  );

  for (const candidate of orderedCandidates) {
    if (added >= MAX_NEW_RESTAURANTS_PER_RUN) break;

    const nameKey = normaliseName(candidate.name);
    const addressKey = normaliseAddress(candidate.address);

    // Conservative duplicate policy: matching name OR address is skipped.
    if (
      knownNames.has(nameKey) ||
      (addressKey && knownAddresses.has(addressKey))
    ) {
      continue;
    }

    if (
      candidate.signalScore < MIN_NEW_SIGNAL_SCORE ||
      !candidate.address ||
      !candidate.cuisine ||
      !candidate.pricePerPerson ||
      candidate.pricePerPerson.confidence === 'low'
    ) {
      continue;
    }

    // Only new candidates are geocoded.
    candidate.coordinates = await geocodeRestaurant(candidate);

    if (!hasValidCoordinates(candidate.coordinates)) {
      console.warn(
        `Rejected ${candidate.name}: no valid address-level coordinates.`
      );
      continue;
    }

    const newRestaurant = canonicalRestaurant(
      {
        id: nextId++,
        name: candidate.name,
        cuisine: candidate.cuisine,
        area: candidate.area,
        suburb: candidate.suburb,
        address: candidate.address,
        googleMapsUrl: candidate.googleMapsUrl,
        coordinates: candidate.coordinates,
        trend: candidate.trend,
        pricePerPerson: candidate.pricePerPerson,
        summary: candidate.summary,
        cons: candidate.cons,
        menuHighlights: candidate.menuHighlights,
        dietary: candidate.dietary,
        themes: candidate.themes,
        comments: [],
        source: candidate.source.url,
        latestNews: mergeNews(
          [],
          [
            candidate.source,
            ...relatedNews(candidate.name, allNews)
          ]
        ),
        updatedAt
      },
      updatedAt
    );

    const missingFields = validateRestaurant(newRestaurant);

    if (missingFields.length) {
      console.warn(
        `Rejected ${candidate.name}: ` +
        `missing or invalid ${missingFields.join(', ')}.`
      );
      continue;
    }

    newRestaurants.push(newRestaurant);
    knownNames.add(nameKey);
    knownAddresses.add(addressKey);
    added += 1;
  }

  const finalRestaurants = [...restaurants, ...newRestaurants];

  // No new restaurants means no write, including no timestamp changes.
  if (!DRY_RUN && added > 0) {
    database.updatedAt = updatedAt;
    database.restaurants = finalRestaurants;

    await writeFile(
      TEMP_DATABASE_PATH,
      `${JSON.stringify(database, null, 2)}\n`
    );

    await rename(TEMP_DATABASE_PATH, DATABASE_PATH);
  }

  console.log(
    JSON.stringify(
      {
        message: DRY_RUN
          ? 'Dry run completed'
          : added > 0
            ? 'New restaurants appended to database'
            : 'No new restaurants found; database unchanged',
        totalProfiles: finalRestaurants.length,
        addedProfiles: added,
        scannedNewsItems: allNews.length,
        enrichedCandidates: candidates.length,
        profilesWithCoordinates: finalRestaurants.filter(
          (restaurant) => hasValidCoordinates(restaurant.coordinates)
        ).length,
        profilesWithPrices: finalRestaurants.filter(
          (restaurant) => restaurant.pricePerPerson
        ).length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});