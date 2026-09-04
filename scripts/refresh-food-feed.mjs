import { mkdir, writeFile } from 'node:fs/promises';

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

await mkdir('dist/data', { recursive: true });
await writeFile('dist/data/viral-feed.json', `${JSON.stringify({ updatedAt: new Date().toISOString(), items: unique }, null, 2)}\n`);
console.log(`Updated ${unique.length} daily food-news links.`);
