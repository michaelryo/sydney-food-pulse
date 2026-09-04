import { mkdir, readFile, writeFile } from 'node:fs/promises';

const searches = [
  { query: 'Sydney restaurant opening', topic: 'New opening' },
  { query: 'Sydney new restaurant review', topic: 'Review' },
  { query: 'Sydney food viral restaurant', topic: 'Trending' },
  { query: 'Sydney restaurant TikTok viral', topic: 'TikTok signal' },
  { query: 'Sydney restaurant Instagram viral', topic: 'Instagram signal' },
  { query: 'Sydney restaurant Facebook viral', topic: 'Facebook signal' },
  { query: 'site:broadsheet.com.au/sydney/food-and-drink Sydney restaurant', topic: 'Broadsheet' },
  { query: 'site:concreteplayground.com/sydney/food-drink Sydney restaurant', topic: 'Concrete Playground' },
  { query: 'site:goodfood.com.au Sydney restaurant', topic: 'Good Food' },
  { query: 'site:timeout.com/sydney/restaurants Sydney', topic: 'Time Out' },
  { query: 'site:theurbanlist.com Sydney restaurant', topic: 'Urban List' },
  { query: 'site:gourmettraveller.com.au Sydney restaurant', topic: 'Gourmet Traveller' },
  { query: 'site:notquitenigella.com Sydney restaurant', topic: 'Not Quite Nigella' },
  { query: 'site:sitchu.com.au Sydney restaurant', topic: 'Sitchu' }
];

const communityFeeds = [
  { url: 'https://www.reddit.com/r/sydney/search.rss?q=restaurant&restrict_sr=on&sort=new&t=week', source: 'Reddit r/sydney', topic: 'Community signal' }
];

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decode(match[1]) : '';
}

async function search({ query, topic }) {
  const endpoint = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-AU&gl=AU&ceid=AU:en`;
  const response = await fetch(endpoint, { headers: { 'user-agent': 'SydneyFoodPulse/1.0' } });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    return { title: tag(block, 'title'), url: tag(block, 'link'), source: tag(block, 'source') || 'Public food news', topic };
  }).filter(item => item.title && item.url);
}

async function communityFeed({ url, source, topic }) {
  const response = await fetch(url, { headers: { 'user-agent': 'SydneyFoodPulse/1.0' } });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(match => {
    const block = match[1];
    const href = block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || tag(block, 'link');
    return { title: tag(block, 'title'), url: href, source, topic };
  }).filter(item => item.title && item.url);
}

const all = [];
for (const entry of searches) {
  try { all.push(...await search(entry)); } catch (error) { console.warn(`Skipped ${entry.query}: ${error.message}`); }
}
for (const entry of communityFeeds) {
  try { all.push(...await communityFeed(entry)); } catch (error) { console.warn(`Skipped ${entry.source}: ${error.message}`); }
}

const unique = [...new Map(all.map(item => [item.title.toLowerCase(), item])).values()].slice(0, 30);
if (!unique.length) throw new Error('No public food-news items were returned; leaving the existing feed untouched.');

const suburbs = [
  { match: /angel place|\bcbd\b|circular quay|\bquay\b/i, suburb: 'Sydney CBD', area: 'CBD & Inner City', coordinates: [-33.8667, 151.2104] },
  { match: /manly wharf|\bmanly\b/i, suburb: 'Manly', area: 'Northern Beaches', coordinates: [-33.8005, 151.2869] },
  { match: /\bnewtown\b/i, suburb: 'Newtown', area: 'Inner West', coordinates: [-33.8981, 151.1790] },
  { match: /bondi junction/i, suburb: 'Bondi Junction', area: 'Eastern Suburbs', coordinates: [-33.8925, 151.2503] },
  { match: /bronte/i, suburb: 'Bronte', area: 'Eastern Suburbs', coordinates: [-33.9057, 151.2662] }
];

function extractRestaurantName(title) {
  const clean = title.replace(/\s+-\s+[^-]+$/, '').trim();
  const patterns = [
    /\b(?:restaurant|osteria)\s+([A-Z][\w’'&.-]*(?:\s+[A-Z][\w’'&.-]*){0,3})\b/,
    /\b((?:Bar|Bistro|Cafe|Café|Trattoria)\s+[A-Z][\w’'&.-]*(?:\s+[A-Z][\w’'&.-]*){0,2})\b/,
    /\bIntroducing\s+(The\s+[A-Z][\w’'&.-]*(?:\s+[A-Z][\w’'&.-]*){0,2})\b/
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractRestaurant(item) {
  const name = extractRestaurantName(item.title);
  const location = suburbs.find(entry => entry.match.test(item.title));
  if (!name || !location) return null;
  return { name, ...location, source: item };
}

await mkdir('dist/data', { recursive: true });
const updatedAt = new Date().toISOString();
const databasePath = 'dist/data/restaurant-database.json';
const database = JSON.parse(await readFile(databasePath, 'utf8'));
database.updatedAt = updatedAt;
delete database.dailyLeads;
const restaurants = database.restaurants || [];
const knownNames = new Set(restaurants.map(restaurant => restaurant.name.toLowerCase()));
let nextId = Math.max(0, ...restaurants.map(restaurant => restaurant.id || 0)) + 1;
for (const item of unique) {
  const candidate = extractRestaurant(item);
  if (!candidate || knownNames.has(candidate.name.toLowerCase())) continue;
  restaurants.push({
    id: nextId++,
    name: candidate.name,
    cuisine: 'To be confirmed',
    area: candidate.area,
    suburb: candidate.suburb,
    coordinates: candidate.coordinates,
    trend: 'Newly found',
    summary: `New restaurant profile found in ${item.source}. Details will be expanded from the linked source.`,
    cons: 'Menu, dietary options and review links have not yet been verified.',
    themes: ['newly found', item.topic || 'public source'],
    comments: [],
    source: item.url,
    latestNews: [item]
  });
  knownNames.add(candidate.name.toLowerCase());
}
database.restaurants = restaurants.map(restaurant => ({
  ...restaurant,
  latestNews: unique.filter(item => item.title.toLowerCase().includes(restaurant.name.toLowerCase())).slice(0, 3)
}));

await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`);
console.log(`Updated restaurant database with ${database.restaurants.length} profiles.`);
