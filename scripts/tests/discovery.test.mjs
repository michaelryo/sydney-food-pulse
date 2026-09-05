import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'food-discovery-'));
process.env.DATABASE_PATH=join(dir,'database.json');
process.env.SKIP_GEOCODE='true';
const api=await import('../refresh-food-feed.mjs');
const {addressInfo,extractVenues,parseFeed,publisherUrl,venueKey,makeProfile,recent,main}=api;
const original={restaurants:[{id:7,name:'Existing Kitchen',address:'12 Harris Street, Pyrmont NSW 2009',updatedAt:'2026-09-01',custom:{keep:true}}],custom:'preserve'};
const xmlEscape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rss=(items=[])=>`<rss><channel>${items.map(i=>`<item><title>${xmlEscape(i.title)}</title><link>${xmlEscape(i.url)}</link><description>${xmlEscape(i.description||'')}</description>${i.date?`<pubDate>${i.date}</pubDate>`:''}</item>`).join('')}</channel></rss>`;
const fixtures=[
 {title:'Sydney food viral',url:'https://www.instagram.com/p/test-venue/',description:'📍 New Kitchen, 14 Harris Street, Pyrmont NSW 2009'},
 {title:'Sydney food viral',url:'https://www.facebook.com/test/posts/123',description:'📍 Existing Kitchen, 12 Harris St, Pyrmont NSW'},
 {title:'New Kitchen opens a second branch',url:'https://example.com/branch',description:'📍 New Kitchen, 16 Harris Street, Pyrmont NSW'},
 {title:'Missing Place opens',url:'https://example.com/no-address',description:'A restaurant in Sydney with no street address.'}
];
async function request(url){
 if(url.includes('format=rss') || url.includes('.rss')) return {url,text:rss(url.includes('restaurant address menu')||decodeURIComponent(url).includes('restaurant address menu')?[]:fixtures)};
 if(url.includes('instagram.com') || url.includes('facebook.com')) throw new Error('HTTP_403');
 return {url,text:'<html><title>Restaurant</title><p>No further details</p></html>'};
}
try {
 await test('name + Sydney address suffices; optional fields are null',()=>{
  const candidates=extractVenues('',fixtures[0]); assert.equal(candidates.length,1);
  const p=makeProfile({...candidates[0],item:{...fixtures[0],kind:'Instagram',source:'Instagram',publishedAt:null}},8,new Date().toISOString(),null);
  assert.equal(p.name,'New Kitchen');assert.equal(p.cuisine,'Unknown');assert.equal(p.coordinates,null);assert.equal(p.pricePerPerson,null);assert.match(p.googleMapsUrl,/google.com\/maps/);
 });
 await test('structured entities keep their own name and address',()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[
   {'@type':'Restaurant',name:'Alpha Kitchen',address:{streetAddress:'14 Harris Street',addressLocality:'Pyrmont'}},
   {'@type':'Restaurant',name:'Beta Kitchen',address:{streetAddress:'16 Harris Street',addressLocality:'Pyrmont'}}]})+'</script>';
  const rows=extractVenues(html,{title:'Two venues'});assert.equal(rows.length,2);assert.match(rows[1].address,/16 Harris/);
 });
 await test('reject non-Sydney and missing street addresses',()=>{
  assert.equal(addressInfo('14 Harris Street, Melbourne VIC'),null);assert.equal(addressInfo('Pyrmont NSW'),null);
  assert.equal(addressInfo('14 Harris Street, Melbourne VIC. Try Pyrmont too'),null);
 });
 await test('RSS links are decoded; Bing wrapper unwrapped; unknown dates remain explicit',()=>{
  const url='https://example.com/story?a=1&b=2';
  const r=parseFeed(rss([{title:'Hello',url}]),'Test')[0];assert.equal(r.url,url);
  assert.equal(publisherUrl('https://www.bing.com/news/apiclick.aspx?url='+encodeURIComponent(url)),url);
  assert.equal(recent(null,Date.now()),true);assert.equal(recent('2000-01-01',Date.now()),false);
 });
 await test('dedup uses name AND address; different branches survive',()=>{
  assert.equal(venueKey(original.restaurants[0]),venueKey({...original.restaurants[0],address:'12 Harris St, Pyrmont, NSW'}));
  assert.notEqual(venueKey(original.restaurants[0]),venueKey({...original.restaurants[0],address:'16 Harris St, Pyrmont, NSW'}));
  assert.notEqual(venueKey({name:'A',address:'1000 Harris Street, Pyrmont NSW'}),venueKey({name:'A',address:'1001 Harris Street, Pyrmont NSW'}));
 });
 await test('end-to-end mocked sources: append, duplicate skip, preserve records and metadata',async()=>{
  await writeFile(process.env.DATABASE_PATH,JSON.stringify(original));await main({request});
  const saved=JSON.parse(await readFile(process.env.DATABASE_PATH,'utf8'));
  assert.deepEqual(saved.restaurants[0],original.restaurants[0]);assert.equal(saved.custom,'preserve');assert.equal(saved.restaurants.length,3);
  assert.equal(saved.restaurants[1].pricePerPerson,null);assert.equal(saved.restaurants[1].coordinates,null);
  const before=await readFile(process.env.DATABASE_PATH,'utf8');await main({request});assert.equal(await readFile(process.env.DATABASE_PATH,'utf8'),before);
 });
 await test('empty discovery does not rewrite the database',async()=>{
  const before=await readFile(process.env.DATABASE_PATH,'utf8');await main({request:async url=>({url,text:rss()})});assert.equal(await readFile(process.env.DATABASE_PATH,'utf8'),before);
 });
 await test('all sources failing reports failure without database damage',async()=>{
  const before=await readFile(process.env.DATABASE_PATH,'utf8');await assert.rejects(main({request:async()=>{throw new Error('HTTP_429')}}),/All discovery sources failed/);assert.equal(await readFile(process.env.DATABASE_PATH,'utf8'),before);
 });
 await test('ambiguous multiple street addresses are not assigned to one title',()=>{
  assert.equal(addressInfo('14 Harris Street, Pyrmont NSW and 16 Harris Street, Pyrmont NSW'),null);
 });
 await test('separate detail lookup resolves a named venue and enriches optional fields',async()=>{
  await writeFile(process.env.DATABASE_PATH,JSON.stringify(original));
  const lead={title:'Named Venue opens',url:'https://example.com/lead',description:'Restaurant in Sydney'};
  const detail={title:'Named Venue menu',url:'https://example.com/details',description:'Named Venue at 18 Harris Street, Pyrmont NSW'};
  await main({request:async url=>{
    if(url.includes('format=rss')||url.includes('.rss')) return {url,text:rss(decodeURIComponent(url).includes('restaurant address menu')?[detail]:[lead])};
    if(url.endsWith('/details')) return {url,text:'<script type="application/ld+json">'+JSON.stringify({'@type':'Restaurant',name:'Named Venue',address:{streetAddress:'18 Harris Street',addressLocality:'Pyrmont'},servesCuisine:'Italian',description:'Set menu $40 per person'})+'</script>'};
    return {url,text:'<html><title>Named Venue opens</title></html>'};
  }});
  const db=JSON.parse(await readFile(process.env.DATABASE_PATH,'utf8'));assert.equal(db.restaurants.length,2);assert.equal(db.restaurants[1].cuisine,'Italian');assert.equal(db.restaurants[1].pricePerPerson.min,40);
 });
 await test('TikTok public oEmbed caption can identify a venue',async()=>{
  await writeFile(process.env.DATABASE_PATH,JSON.stringify(original));
  await main({request:async url=>{
    if(url.includes('format=rss')||url.includes('.rss')) return {url,text:rss(decodeURIComponent(url).includes('restaurant address menu')?[]:[{title:'Sydney food',url:'https://www.tiktok.com/@creator/video/123456'}])};
    if(url.includes('/oembed')) return {url,text:JSON.stringify({title:'📍 Tik Kitchen, 20 Harris Street, Pyrmont NSW',html:'<blockquote>Public caption</blockquote>'})};
    throw Error('unexpected URL');
  }});
  const db=JSON.parse(await readFile(process.env.DATABASE_PATH,'utf8'));assert.equal(db.restaurants[1].name,'Tik Kitchen');assert.equal(db.restaurants[1].trend,'Social mention');
 });
 await test('dry run with accepted candidates does not write',async()=>{
  const before=await readFile(process.env.DATABASE_PATH,'utf8');
  process.env.DRY_RUN='true';
  const dry=await import('../refresh-food-feed.mjs?dry-run');
  delete process.env.DRY_RUN;
  await dry.main({request});assert.equal(await readFile(process.env.DATABASE_PATH,'utf8'),before);
 });
 await test('invalid database refuses writes',async()=>{
  await writeFile(process.env.DATABASE_PATH,'{"wrong":[]}');await assert.rejects(main({request}),/Invalid restaurant database/);assert.equal(await readFile(process.env.DATABASE_PATH,'utf8'),'{"wrong":[]}');
 });
} finally {await rm(dir,{recursive:true,force:true});}
