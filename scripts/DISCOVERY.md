# Restaurant discovery

Run with Node 24: `node scripts/refresh-food-feed.mjs`.

The script appends new venues identified by name and a Sydney street address.
Existing records are preserved. The separate cleanup script and its
`RESTAURANT_RETENTION_DAYS` setting are unchanged.

## Sources and enrichment

- Direct current Broadsheet Sydney food coverage provides dated article URLs.
  Bing web RSS searches target public TikTok, Instagram and Facebook pages. Relevant results from other websites are also retained;
  Bing News and Reddit feeds supplement them. Google News RSS is no longer a
  default source because publisher redirects were consistently unresolved. Search providers may block
  requests, change their feeds, omit social posts or return no results.
- Public TikTok video URLs use the documented oEmbed endpoint for captions.
  Instagram/Facebook pages use publicly accessible HTML or indexed snippets.
  The script does not log in, bypass challenges or access private content.
- Multiple Restaurant entities in JSON-LD, caption location pins and explicit
  name/address blocks can identify venues. Publisher article dates are checked
  against the lookback window. Generic chef/headline fragments are rejected,
  and social searches prefer the requested platform while accepting relevant cross-platform results. A title-only discovery can trigger a separate
  venue lookup. Details are merged only for the same normalized venue name and,
  if already known, the same address.
- Cuisine and explicitly published per-person prices come from venue/publisher
  content. Unknown values remain `Unknown` / `null`. Arbitrary menu prices are
  not converted into a supposed per-person budget.
- OpenStreetMap Nominatim optionally locates the address, with sequential
  requests at least 1.1 seconds apart. A matching house number and road are
  required. Failure leaves coordinates null; no suburb-centre pin is invented.
- Every accepted venue gets a Google Maps search link. **This does not fetch
  Google Maps details or ratings.** No Google API key or paid service is used.

A public mention is a discovery signal, not proof of virality. Search results
without dates are explicitly marked with an unknown publication date. Known
publication dates outside the lookback are rejected. Database `updatedAt` is
set only when a venue is first appended, so cleanup uses time since discovery,
not the social post's age. No scraper can enumerate all viral restaurants.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| DATABASE_PATH | dist/data/restaurant-database.json | Database file |
| DISCOVERY_LOOKBACK_DAYS | 30 | Known publication date cutoff |
| MAX_DISCOVERY_PAGES | 120 | Candidate-page budget |
| MAX_NEW_RESTAURANTS_PER_RUN | 30 | Addition budget |
| MAX_DETAIL_LOOKUPS | 20 | Extra venue-detail searches |
| DISCOVERY_FEED_URLS | empty | Comma-separated additional public RSS/Atom feeds |
| DISCOVERY_USER_AGENT | project URL identifier | Public request identification |
| DRY_RUN | false | Discover and report without saving |
| SKIP_FETCH | false | No discovery requests; useful for preservation checks |
| SKIP_GEOCODE | false | Leave coordinates unknown |

Budgets limit requests, not the number of existing records. Repeat candidates
are deduplicated by normalized name **and** address, allowing different branches
and different restaurants sharing a building. Identity matching is heuristic;
inspect source links for uncertain matches.

## Diagnostics and tests

The Actions log and step summary contain feed statuses, request failures,
name/address rejection counts, duplicates and accepted venues. Complete feed
failure fails the discovery step (and prevents that run's later cleanup and
deployment); runs that identify only known venues remain successful. A run finding no
usable identities fails with `Discovery ineffective`, so a green deployment
will not hide an unusable discovery run. No additions and dry runs leave the
database unchanged. A failed discovery step prevents later cleanup/deployment
in that daily run; the next successful run resumes the normal pipeline. Network fetches have timeouts, redirect and
response-size limits; 429 responses suppress further requests to that host.

Run `node --test scripts/tests/discovery.test.mjs`. These use controlled public
page/feed fixtures and a temporary database, with no live social requests.
The repair-branch validation workflow runs live discovery with DRY_RUN=true
and SKIP_GEOCODE=true, then checks that the database did not change. This is
a read-only source validation; it does not publish or commit restaurant data.
Fixture tests alone do not establish real-world source coverage.
