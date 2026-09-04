import { readFile, writeFile } from 'node:fs/promises';

const retentionDays = Number(process.env.RESTAURANT_RETENTION_DAYS || 30);
if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  throw new Error('RESTAURANT_RETENTION_DAYS must be a positive number.');
}

const databasePath = 'dist/data/restaurant-database.json';
const database = JSON.parse(await readFile(databasePath, 'utf8'));
const retentionCutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
const restaurants = database.restaurants || [];
const retained = restaurants.filter(restaurant => {
  if (restaurant.trend === 'Newly found' && !restaurant.address) return false;
  if (!restaurant.updatedAt) return true;
  const timestamp = Date.parse(restaurant.updatedAt);
  return Number.isNaN(timestamp) || timestamp >= retentionCutoff;
});

const removedCount = restaurants.length - retained.length;
database.restaurants = retained;
await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`);
console.log(`Removed ${removedCount} restaurant${removedCount === 1 ? '' : 's'} older than ${retentionDays} days or missing an address.`);
