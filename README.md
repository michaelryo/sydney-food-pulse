# Sydney Food Pulse

[![Deploy to GitHub Pages](https://github.com/michaelryo/sydney-food-pulse/actions/workflows/deploy-github-pages.yml/badge.svg)](https://github.com/michaelryo/sydney-food-pulse/actions/workflows/deploy-github-pages.yml)
[![Daily feed refresh](https://github.com/michaelryo/sydney-food-pulse/actions/workflows/refresh-food-feed.yml/badge.svg)](https://github.com/michaelryo/sydney-food-pulse/actions/workflows/refresh-food-feed.yml)

Sydney Food Pulse is a lightweight, static guide to restaurants currently attracting attention across Sydney. It turns recent public food-news and community signals into searchable editorial profiles with cuisine, suburb, price, map, source, and "worth knowing" details.

**Live site:** [michaelryo.github.io/sydney-food-pulse](https://michaelryo.github.io/sydney-food-pulse/)

## What it does

- Searches recent Sydney restaurant coverage through Google News and Bing News RSS feeds.
- Reads public pages for restaurant names, addresses, cuisine, location, price signals, dietary signals, and menu highlights.
- Deduplicates restaurant profiles and preserves existing profiles when a refresh cannot verify a newer result.
- Displays the generated database in a responsive static site with search, filters, price filtering, and a Leaflet map.
- Removes newly discovered entries without an address and profiles older than the configured retention period.

The content is a public-source editorial summary, not a guarantee that a venue is open, that prices are current, or that a dish is suitable for an allergy. Check the linked venue or review listing before travelling.

## Repository layout

```text
dist/
  index.html                         Static site
  data/restaurant-database.json      Generated restaurant data
scripts/
  refresh-food-feed.mjs              Fetch, enrich, score, and write profiles
  remove-expired-restaurants.mjs     Apply retention and address cleanup
.github/workflows/
  deploy-github-pages.yml            Deploy dist on pushes to main
  refresh-food-feed.yml              Refresh and deploy the feed daily
```

## Run locally

Requirements:

- Node.js 20 or newer
- Network access for a live refresh

No npm dependencies are required. From the repository root:

```powershell
# Serve the static site locally (use any static file server you prefer)
npx --yes serve dist
```

The site can also be opened directly from `dist/index.html`, although a local server is recommended because the page loads JSON with `fetch`.

## Refresh the data

Run a real refresh, then remove expired profiles:

```powershell
node scripts/refresh-food-feed.mjs
$env:RESTAURANT_RETENTION_DAYS = "30"
node scripts/remove-expired-restaurants.mjs
```

Useful refresh options:

```powershell
# Fetch and parse sources without changing the database
$env:DRY_RUN = "true"; node scripts/refresh-food-feed.mjs

# Skip network fetching and exercise the merge/write path
$env:SKIP_FETCH = "true"; node scripts/refresh-food-feed.mjs

# Write to a different JSON file for testing
$env:DATABASE_PATH = "tmp/restaurant-database.json"; node scripts/refresh-food-feed.mjs
```

The refresh process is deliberately conservative: failed sources are skipped, and a restaurant is only added when the required location, address, cuisine, and price signals are available. Generated data is committed to `dist/data/restaurant-database.json` by the scheduled GitHub Action.

## GitHub Pages setup

In the repository on GitHub:

1. Open **Settings > Pages**.
2. Set **Build and deployment > Source** to **GitHub Actions**.
3. Confirm the `github-pages` environment is available under **Settings > Environments**.
4. Ensure Actions are enabled under **Settings > Actions > General**. The workflows require repository write access to commit refreshed JSON and Pages deployment access.

The deploy workflow publishes `dist` whenever `main` changes. The refresh workflow runs daily at `21:00 UTC` (typically 07:00 or 08:00 Sydney time), and can also be started from **Actions > Refresh daily food feed > Run workflow**.

## Contributing

Small, focused pull requests are welcome. Keep generated data changes separate from unrelated UI or script changes where possible. Before opening a pull request:

```powershell
node --check scripts/refresh-food-feed.mjs
node --check scripts/remove-expired-restaurants.mjs
```

Please do not add private, scraped, or copyrighted material to the repository. Link to public sources and preserve the source URL in generated records.

## Licence and data sources

This repository contains original application code and generated summaries derived from public sources. The source links and third-party services remain subject to their own terms and licences. Add an explicit project licence before redistributing the code if that is required for your use case.
