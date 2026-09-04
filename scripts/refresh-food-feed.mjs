import { mkdir, writeFile } from 'node:fs/promises';

const searches = [
  'Sydney restaurant opening',
  'Sydney food viral restaurant',
  'Sydney new restaurant review'
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

async function search(query) {
  const endpoint = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-AU&gl=AU&ceid=AU:en`;
  const response = await fetch(endpoint, { headers: { 'user-agent': 'SydneyFoodPulse/1.0' } });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    return { title: tag(block, 'title'), url: tag(block, 'link'), source: tag(block, 'source') || 'Public food news' };
  }).filter(item => item.title && item.url);
}

const all = [];
for (const query of searches) {
  try { all.push(...await search(query)); } catch (error) { console.warn(`Skipped ${query}: ${error.message}`); }
}

const unique = [...new Map(all.map(item => [`${item.title}|${item.url}`, item])).values()].slice(0, 9);
if (!unique.length) throw new Error('No public food-news items were returned; leaving the existing feed untouched.');

await mkdir('dist/data', { recursive: true });
await writeFile('dist/data/viral-feed.json', `${JSON.stringify({ updatedAt: new Date().toISOString(), items: unique }, null, 2)}\n`);
console.log(`Updated ${unique.length} daily food-news links.`);
