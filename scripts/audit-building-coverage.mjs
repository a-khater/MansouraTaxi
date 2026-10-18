import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const options = { map: join(root, 'assets', 'mansoura-map.json'), references: join(root, 'assets', 'building-references.json'), output: join(root, 'artifacts', 'building-coverage.json') };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in options) || !process.argv[i + 1]) throw new Error('Usage: node scripts/audit-building-coverage.mjs [--map path] [--references path] [--output path]');
  options[key] = resolve(process.argv[i + 1]);
}
const map = JSON.parse(await readFile(options.map, 'utf8'));
let catalog = { entries: [] }, catalogAvailable = true;
try { catalog = JSON.parse(await readFile(options.references, 'utf8')); }
catch (error) { if (error.code === 'ENOENT') catalogAvailable = false; else throw error; }
if (!Array.isArray(map.buildings)) throw new Error('Map JSON must contain a buildings array.');
if (!Array.isArray(catalog.entries)) throw new Error('Reference catalog must contain an entries array.');
if (catalog.landmarks != null && !Array.isArray(catalog.landmarks)) throw new Error('Reference catalog landmarks must be an array when present.');
if (!Number.isFinite(map.start?.x) || !Number.isFinite(map.start?.z)) throw new Error('Map JSON must contain a finite start position.');

const mapped = map.buildings.map(building => ({ ...building, kind: 'mapped' }));
const inferred = (map.inferredBuildings || []).map(building => ({ ...building, kind: 'inferred' }));
const buildings = [...mapped, ...inferred], byId = new Map(buildings.map(b => [String(b.id), b]));
const countValues = values => values.reduce((result, value) => { const key = value == null || value === '' ? '(missing)' : String(value); result[key] = (result[key] || 0) + 1; return result; }, {});
const hasTag = (building, key) => building.tags?.[key] != null && String(building.tags[key]).trim() !== '';
function heightAndFloors(list) {
  const rawFloorKeys = ['building:levels', 'building:levels:aboveground', 'building:levels:underground', 'roof:levels', 'level'];
  return {
    heightSourceCounts: countValues(list.map(b => b.heightSource)),
    buildingsWithOsmHeightTag: list.filter(b => hasTag(b, 'height')).length,
    buildingsWithOsmFloorTag: list.filter(b => rawFloorKeys.some(key => hasTag(b, key))).length,
    floorTagCounts: Object.fromEntries(rawFloorKeys.map(key => [key, {
      buildings: list.filter(b => hasTag(b, key)).length,
      values: countValues(list.filter(b => hasTag(b, key)).map(b => b.tags[key])),
    }])),
    generatedLevelsPresent: list.filter(b => b.levels != null).length,
    generatedLevelsValues: countValues(list.filter(b => b.levels != null).map(b => b.levels)),
  };
}
function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}
function footprintDistance(point, building) {
  const outer = building.points || building.polygon || [], holes = building.holes || [];
  if (outer.length < 3) return Infinity;
  if (inside(point, outer) && !holes.some(hole => inside(point, hole))) return 0;
  let best = Infinity;
  for (const ring of [outer, ...holes]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t));
  }
  return best;
}
const allowedStatuses = new Set(['photo-referenced', 'survey-verified']);
const referenceUrls = entry => (Array.isArray(entry.references) ? entry.references : [])
  .map(r => typeof r === 'string' ? r : r?.url).filter(url => typeof url === 'string' && /^https?:\/\//i.test(url.trim())).map(url => url.trim());
const matched = [], unmatchedBuildingIds = [], invalidStatuses = [];
for (const entry of catalog.entries) {
  const id = String(entry.buildingId ?? '');
  if (!byId.has(id)) { unmatchedBuildingIds.push(id); continue; }
  if (!allowedStatuses.has(entry.status)) { invalidStatuses.push({ buildingId: id, status: entry.status ?? null }); continue; }
  const references = referenceUrls(entry);
  matched.push({ buildingId: id, status: entry.status, references, origin: 'building-entry' });
}
const landmarks = (catalog.landmarks || []).map((entry, index) => ({
  landmarkId: entry.landmarkId ?? entry.id ?? `catalog-landmark-${index + 1}`,
  name: entry.name ?? null, status: entry.status ?? null,
  recognizedStatus: allowedStatuses.has(entry.status), references: referenceUrls(entry),
  replacesBuildingIds: [...new Set((Array.isArray(entry.replacesBuildingIds) ? entry.replacesBuildingIds : []).map(String))],
}));
const landmarkReplacementLinks = [], invalidReplacementIds = [];
for (const landmark of landmarks) for (const buildingId of landmark.replacesBuildingIds) {
  const building = byId.get(buildingId);
  if (!building || building.kind !== 'mapped') {
    invalidReplacementIds.push({ landmarkId: landmark.landmarkId, buildingId,
      reason: building ? 'Replacement refers to inferred frontage, not a mapped building footprint.' : 'No matching building ID exists in the map.' });
    continue;
  }
  const link = { buildingId, landmarkId: landmark.landmarkId, status: landmark.status, origin: 'landmark-replacement' };
  landmarkReplacementLinks.push({ ...link, referenceUrlCount: landmark.references.length });
  if (landmark.recognizedStatus) matched.push({ ...link, references: landmark.references });
}
const withReferences = new Set(matched.filter(e => e.references.length).map(e => e.buildingId));
function referenceCounts(list) {
  const ids = new Set(list.map(b => String(b.id))), entries = matched.filter(entry => ids.has(entry.buildingId));
  return {
    declaredPhotoReferencedBuildings: new Set(entries.filter(e => e.status === 'photo-referenced').map(e => e.buildingId)).size,
    declaredSurveyVerifiedBuildings: new Set(entries.filter(e => e.status === 'survey-verified').map(e => e.buildingId)).size,
    photoReferencedBuildingsWithUrls: new Set(entries.filter(e => e.status === 'photo-referenced' && e.references.length).map(e => e.buildingId)).size,
    surveyVerifiedBuildingsWithUrls: new Set(entries.filter(e => e.status === 'survey-verified' && e.references.length).map(e => e.buildingId)).size,
    buildingsWithAnyReferenceUrl: list.filter(b => withReferences.has(String(b.id))).length,
    missingReferenceCount: list.filter(b => !withReferences.has(String(b.id))).length,
    referenceUrlMentions: entries.reduce((sum, e) => sum + e.references.length, 0),
    uniqueReferenceUrls: new Set(entries.flatMap(e => e.references)).size,
  };
}
function nearest(list, limit) {
  return list.map(building => ({ building, distance: footprintDistance(map.start, building) }))
    .filter(item => Number.isFinite(item.distance)).sort((a, b) => a.distance - b.distance).slice(0, limit)
    .map(({ building: b, distance }) => ({ buildingId: b.id, osmId: b.osmId ?? null, kind: b.kind,
      name: b.tags?.['name:en'] || b.tags?.name || null, distanceMetres: Math.round(distance * 100) / 100,
      heightMetres: b.height ?? null, heightSource: b.heightSource ?? null, generatedLevels: b.levels ?? null,
      osmFloorTags: Object.fromEntries(Object.entries(b.tags || {}).filter(([key]) => key.includes('level'))),
      declaredReferenceStatuses: [...new Set(matched.filter(entry => entry.buildingId === String(b.id)).map(entry => entry.status))],
      referenceOrigins: [...new Set(matched.filter(entry => entry.buildingId === String(b.id)).map(entry => entry.origin))],
      hasReferenceUrl: withReferences.has(String(b.id)) }));
}
const nearestMapped = nearest(mapped, 1)[0] || null;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { map: options.map, referenceCatalog: options.references, catalogAvailable,
    mapRetrievedAt: map.provenance?.retrievedAt ?? null, osmBaseTimestamp: map.provenance?.osmBaseTimestamp ?? null },
  interpretation: {
    purpose: 'Inventory of building geometry, height provenance and reference records; not a visual similarity score.',
    mapped: 'An OSM footprint is mapped geometry, not confirmation of complete coverage or current facade detail.',
    inferred: 'Inferred frontage is separate from mapped OSM buildings and has no surveyed geometry claim.',
    heights: 'OSM height/floor tags and generated massing levels are counted separately. A tag is not independent survey verification.',
    references: 'Photo-reference and survey-verified are separate catalog-declared statuses. This audit checks URL presence, not photo relevance, measurement quality or survey validity.',
    landmarks: 'Landmarks are counted separately. An explicit replacesBuildingIds link can credit an existing mapped footprint with the same catalog-declared reference status, recorded as landmark-replacement. Unique building IDs are counted once; a replacement never adds a new building or establishes survey verification.',
    distance: 'Nearest footprint-edge distance in projected metres, respecting courtyard holes; not visibility or facade-identification certainty.',
  },
  totals: { mapped: mapped.length, inferred: inferred.length, all: buildings.length },
  heightAndFloors: { mapped: heightAndFloors(mapped), inferred: heightAndFloors(inferred) },
  references: { catalogEntries: catalog.entries.length, matchedEntries: matched.length,
    matchedDirectBuildingEntries: matched.filter(entry => entry.origin === 'building-entry').length,
    unmatchedBuildingIds: [...new Set(unmatchedBuildingIds)], invalidStatuses,
    landmarkReplacementLinks, invalidReplacementIds,
    records: matched.map(({ references, ...entry }) => ({ ...entry, referenceUrlCount: references.length })),
    mapped: referenceCounts(mapped), inferred: referenceCounts(inferred), all: referenceCounts(buildings) },
  landmarkReferences: {
    catalogLandmarks: landmarks.length,
    declaredPhotoReferencedLandmarks: landmarks.filter(e => e.status === 'photo-referenced').length,
    declaredSurveyVerifiedLandmarks: landmarks.filter(e => e.status === 'survey-verified').length,
    photoReferencedLandmarksWithUrls: landmarks.filter(e => e.status === 'photo-referenced' && e.references.length).length,
    surveyVerifiedLandmarksWithUrls: landmarks.filter(e => e.status === 'survey-verified' && e.references.length).length,
    landmarksWithAnyReferenceUrl: landmarks.filter(e => e.references.length).length,
    missingReferenceCount: landmarks.filter(e => !e.references.length).length,
    referenceUrlMentions: landmarks.reduce((sum, e) => sum + e.references.length, 0),
    uniqueReferenceUrls: new Set(landmarks.flatMap(e => e.references)).size,
    invalidStatuses: landmarks.filter(e => !e.recognizedStatus).map(e => ({ landmarkId: e.landmarkId, status: e.status })),
    entries: landmarks.map(({ references, recognizedStatus, ...entry }) => ({ ...entry, referenceUrlCount: references.length })),
  },
  start: { x: map.start.x, z: map.start.z, heading: map.start.heading ?? null },
  nearestFiveToStart: nearest(buildings, 5),
  nearestMappedToStart: nearestMapped,
  nearestMappedDistanceMetres: nearestMapped?.distanceMetres ?? null,
};
await mkdir(dirname(options.output), { recursive: true });
await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
