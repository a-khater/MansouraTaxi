"""Normalize the downloaded OSM snapshot (requires shapely).
Retains actual coordinates/topology. Widths/heights without measurements are
explicitly marked inferred. Does not geocode invented landmark positions.
"""
import collections
import json
import math
import pathlib
import re
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union
from shapely.affinity import rotate
from shapely.prepared import prep

ROOT = pathlib.Path(__file__).resolve().parents[1]


def normalize(data):
    bounds = data['bounds']
    clip = box(bounds['minX'], bounds['minZ'], bounds['maxX'], bounds['maxZ'])
    features = data['features']
    coords = lambda points: [(p['x'], p['z']) for p in points]
    points = lambda ring: [{'x': round(x, 3), 'z': round(z, 3)} for x, z in list(ring.coords)[:-1]]
    shapes = lambda geom: list(geom.geoms) if hasattr(geom, 'geoms') else [geom]
    def number(value):
        match = re.search(r'[\d.]+', str(value or ''))
        return float(match[0]) if match else None
    def polygon(feature):
        try:
            pts = coords(feature.get('points', []))
            return Polygon(pts).buffer(0).intersection(clip) if len(pts) > 3 else Polygon()
        except Exception:
            return Polygon()

    segments, paths = [], []
    allowed = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'service', 'living_street', 'road'}
    for f in features:
        tags = f['tags']; highway = tags.get('highway')
        if not highway or len(f.get('points', [])) < 2:
            continue
        parts = shapes(LineString(coords(f['points'])).intersection(clip))
        node_lookup = {(p['x'], p['z']): p.get('nodeId') for p in f['points']}
        oneway = -1 if tags.get('oneway') == '-1' else 1 if tags.get('oneway') in ['yes', '1', 'true'] or tags.get('junction') == 'roundabout' else 0
        width = number(tags.get('width'))
        width_source = 'OSM width' if width else 'inferred from OSM road class'
        if not width and number(tags.get('lanes')):
            width = number(tags['lanes']) * 3.1; width_source = 'inferred from OSM lane count'
        if not width:
            width = {'trunk': 13, 'primary': 8.2 if oneway else 11, 'secondary': 8, 'tertiary': 7, 'residential': 5.7, 'service': 4.3}.get(highway, 5)
        width = round(max(3, min(width, 19)), 2)
        for part_index, part in enumerate(parts):
            if part.geom_type != 'LineString' or part.length < 1:
                continue
            pp = []
            for i, (x, z) in enumerate(part.coords):
                pp.append({'x': round(x, 3), 'z': round(z, 3), 'nodeId': node_lookup.get((x, z)) or f'clip:{f["osmId"]}:{part_index}:{i}'})
            item = {'id': f'way/{f["osmId"]}/{part_index}', 'osmId': f['osmId'], 'points': pp, 'width': width, 'widthSource': width_source, 'name': tags.get('name:ar', tags.get('name', '')), 'nameEn': tags.get('name:en', ''), 'highway': highway, 'oneway': oneway, 'bridge': tags.get('bridge') not in [None, 'no'], 'layer': number(tags.get('layer')) or 0, 'tags': tags}
            if highway in allowed:
                segments.append(item)
            else:
                item['width'] = 2.4; paths.append(item)
    # Keep the connected public network for navigation. Disconnected mapped
    # driveways remain in the visual data, without creating teleporting routes.
    parent = {}
    def find(n):
        parent.setdefault(n, n)
        if parent[n] != n: parent[n] = find(parent[n])
        return parent[n]
    for s in segments:
        for a, b in zip(s['points'], s['points'][1:]):
            aa, bb = find(str(a['nodeId'])), find(str(b['nodeId']))
            parent[aa] = bb
    counts = collections.Counter(find(n) for n in list(parent))
    largest = counts.most_common(1)[0][0]
    disconnected = [s for s in segments if find(str(s['points'][0]['nodeId'])) != largest]
    segments = [s for s in segments if find(str(s['points'][0]['nodeId'])) == largest]

    water_geometry = []
    for f in features:
        if f['tags'].get('natural') != 'water' and f['tags'].get('waterway') != 'riverbank':
            continue
        if f.get('members'):
            outer = [LineString(coords(m['points'])) for m in f['members'] if m['role'] == 'outer' and len(m['points']) > 1]
            merged = unary_union(list(polygonize(MultiLineString(outer))))
            inners = [Polygon(coords(m['points'])).buffer(0) for m in f['members'] if m['role'] == 'inner' and len(m['points']) > 3]
            if inners: merged = merged.difference(unary_union(inners))
            geo = merged.intersection(clip)
        else:
            geo = polygon(f)
        water_geometry.extend([g for g in shapes(geo) if g.geom_type == 'Polygon' and g.area > 5])
    water_union = unary_union(water_geometry)
    water = [{'id': f'water/{i}', 'osmId': 2063788, 'points': points(g.exterior), 'holes': [points(h) for h in g.interiors]} for i, g in enumerate(water_geometry)]
    # OSM bridge tags can end slightly inside the mapped riverbank. Clear the
    # collision mask along the SAME connected approach roads as well; a flat
    # bridge-only cap strands the vehicle at that boundary. The 35 m approach
    # limit is an inferred collision allowance, not a change to source geometry.
    bridge_buffers = []
    by_node = collections.defaultdict(list)
    for segment in segments:
        for point in segment['points']:
            by_node[str(point['nodeId'])].append(segment)
    for segment in segments:
        if not segment['bridge']:
            continue
        bridge_buffers.append(LineString(coords(segment['points'])).buffer(segment['width'] / 2 + 2.5))
        for endpoint in (segment['points'][0], segment['points'][-1]):
            vicinity = Point(endpoint['x'], endpoint['z']).buffer(35)
            for approach in by_node[str(endpoint['nodeId'])]:
                if approach['id'] == segment['id'] or approach['layer'] < 0:
                    continue
                line = LineString(coords(approach['points'])).intersection(vicinity)
                if not line.is_empty:
                    bridge_buffers.append(line.buffer(approach['width'] / 2 + 2.5))
    collision_water = water_union.difference(unary_union(bridge_buffers)) if bridge_buffers else water_union
    water_collision = [{'id': f'water-collision/{i}', 'points': points(g.exterior), 'holes': [points(h) for h in g.interiors]} for i, g in enumerate(shapes(collision_water)) if g.geom_type == 'Polygon' and g.area > 5]

    buildings, areas, pois = [], [], []
    for f in features:
        tags = f['tags']; geo = None
        if tags.get('building') and len(f.get('points', [])) > 3:
            geo = polygon(f)
            height = number(tags.get('height')); source = 'OSM height' if height else None
            levels = number(tags.get('building:levels'))
            if not height and levels: height = levels * 3.3; source = 'inferred from OSM building:levels'
            if not height: height = 13.2 + (f['osmId'] % 7) * 3.3; source = 'inferred visual massing; no OSM height'
            for i, part in enumerate(shapes(geo)):
                if part.geom_type == 'Polygon' and part.area > 7:
                    buildings.append({'id': f'building/{f["osmId"]}/{i}', 'osmId': f['osmId'], 'points': points(part.exterior), 'holes': [points(h) for h in part.interiors], 'height': round(max(3, min(100, height)), 2), 'levels': levels or max(1, round(height / 3.3)), 'heightSource': source, 'accuracy': {'footprint': 'mapped OpenStreetMap geometry', 'height': source, 'facade': 'procedural, not surveyed'}, 'tags': tags})
        if (tags.get('landuse') or tags.get('leisure')) and len(f.get('points', [])) > 3:
            geo = geo or polygon(f)
            # Landuse polygons can enclose both city and river (for example a
            # broad residential boundary). They are not a land/water mask.
            # Keep their mapped land portions without painting over the Nile.
            geo = geo.difference(water_union)
            for i, part in enumerate(shapes(geo)):
                if part.geom_type == 'Polygon' and part.area > 10:
                    areas.append({'id': f'area/{f["osmId"]}/{i}', 'osmId': f['osmId'], 'points': points(part.exterior), 'holes': [points(h) for h in part.interiors], 'tags': tags})
        if tags.get('name') and ('amenity' in tags or 'tourism' in tags or tags.get('leisure') == 'stadium'):
            if f.get('point'): p = Point(f['point']['x'], f['point']['z'])
            elif f.get('points'): p = (geo or polygon(f)).representative_point()
            elif f.get('members'):
                candidates = [Polygon(coords(m['points'])).buffer(0) for m in f['members'] if len(m['points']) > 3 and m['role'] != 'inner']
                p = max(candidates, key=lambda c: c.area).representative_point() if candidates else Point()
            else: p = Point()
            if not p.is_empty and clip.covers(p): pois.append({'id': f'{f["osmType"]}/{f["osmId"]}', 'osmId': f['osmId'], 'osmType': f['osmType'], 'x': round(p.x, 3), 'z': round(p.y, 3), 'name': tags.get('name:ar', tags.get('name', '')), 'nameEn': tags.get('name:en', tags.get('name', '')), 'tags': tags})

    road_lines = [(s, LineString(coords(s['points']))) for s in segments]
    def snap(x, z, preferred=None):
        candidates = [(s, line) for s, line in road_lines if preferred is None or s['osmId'] in preferred]
        s, line = min(candidates, key=lambda entry: entry[1].distance(Point(x, z)))
        p = line.interpolate(line.project(Point(x, z)))
        # Choose the local tangent for the starting vehicle and district labels.
        d = line.project(p); a = line.interpolate(max(0, d - .5)); b = line.interpolate(min(line.length, d + .5))
        return {'x': round(p.x, 3), 'z': round(p.y, 3), 'heading': math.atan2(-(b.x - a.x), -(b.y - a.y)), 'segmentId': s['id']}
    # This actual Al Mashaya point is about 11 m from the mapped riverbank.
    # The western stretch sits behind a much wider strip of mapped land.
    start = snap(0, -394, {263225726})
    landmarks = []
    manual = [
        ('mashaya', 'Al Mashaya Corniche', 'المشاية السفلى', -600, -250, 263225726, 'Mapped Nile-side carriageway; actual road alignment.', {263225726}),
        ('gomhouria', 'Al-Gomhouria Street', 'شارع الجمهورية', -1150, -105, 584524658, 'The mapped Al-Gomhouria corridor toward Mansoura University.', {167439775, 584524658, 278480505}),
        ('university', 'Mansoura University', 'جامعة المنصورة', -1680, -175, 17091862, 'Al-Gomhouria street access beside the mapped university campus.', {167439775}),
        ('talkha', 'Talkha Bridge', 'كوبري طلخا', 494, -410, 201303304, 'Actual mapped bridge approach to Talkha.', {201303304}),
    ]
    for ident, name, ar, x, z, osm_id, description, preferred in manual:
        landmarks.append({'id': ident, 'name': name, 'arabic': ar, **snap(x, z, preferred), 'description': description, 'osmId': osm_id, 'locationSource': 'OSM road geometry; street access point'})
    selected_pois = [1437032099, 3118482928, 3118641523, 3118483532, 1437032102, 614809959]
    for osm_id in selected_pois:
        p = next((p for p in pois if p['osmId'] == osm_id), None)
        if p:
            # The stadium's nearest service drive joins an outbound carriageway
            # cut by this extract's south edge. Use the nearby mapped public
            # street so the pickup can also return through the bounded network.
            preferred = {696447139} if osm_id == 614809959 else None
            landmarks.append({'id': str(osm_id), 'name': p['nameEn'], 'arabic': p['name'], **snap(p['x'], p['z'], preferred), 'description': 'Street pickup near this mapped OpenStreetMap point of interest.', 'osmId': osm_id, 'poi': {'x': p['x'], 'z': p['z']}, 'locationSource': 'OSM POI; pickup projected to connected road'})
    # Optional visual massing along the two focus streets. These are explicitly
    # separate from mapped buildings; never used to invent roads or replace a
    # mapped footprint. Conservative setbacks preserve road and park geometry.
    protected_parts = [Polygon(coords(b['points'])).buffer(2) for b in buildings]
    protected_parts += [line.buffer(s['width'] / 2 + 2.5) for s, line in road_lines]
    protected_parts += [Polygon(coords(a['points'])).buffer(.5) for a in areas if a['tags'].get('landuse') != 'residential']
    protected_parts.append(water_union.buffer(1))
    university = next((f for f in features if f['osmId'] == 17091862), None)
    if university:
        protected_parts += [Polygon(coords(m['points'])).buffer(0) for m in university.get('members', []) if len(m['points']) > 3 and m['role'] != 'inner']
    protected = prep(unary_union(protected_parts))
    inferred, occupied = [], []
    for s, line in road_lines:
        if s['osmId'] not in {263225726, 167439775, 584524658, 278480505}: continue
        for d in range(15, int(line.length) - 15, 21):
            p = line.interpolate(d); a = line.interpolate(d - 1); b = line.interpolate(d + 1)
            angle = math.atan2(b.y - a.y, b.x - a.x)
            for side in [-1, 1]:
                offset = s['width'] / 2 + 12
                x = p.x - math.sin(angle) * offset * side; z = p.y + math.cos(angle) * offset * side
                candidate = rotate(box(x - 8.4, z - 8.5, x + 8.4, z + 8.5), angle, origin=(x, z), use_radians=True)
                if not clip.covers(candidate) or protected.intersects(candidate) or any(candidate.intersects(c) for c in occupied): continue
                ident = len(inferred); occupied.append(candidate.buffer(1))
                inferred.append({'id': f'inferred-frontage/{ident}', 'anchorRoadOsmId': s['osmId'], 'points': points(candidate.exterior), 'holes': [], 'height': 19.8 + (ident % 6) * 3.3, 'levels': 6 + ident % 6, 'heightSource': 'inferred visual massing; no surveyed height', 'accuracy': {'footprint': 'inferred frontage on unmapped lot; not an OSM building', 'height': 'inferred', 'facade': 'procedural, not surveyed'}, 'tags': {'building': 'apartments', 'inferred': 'yes'}})
    data.pop('features')
    data.update({'roads': {'segments': segments}, 'paths': paths + disconnected, 'buildings': buildings, 'inferredBuildings': inferred, 'water': water, 'waterColliders': water_collision, 'areas': areas, 'pois': pois, 'landmarks': landmarks, 'start': start})
    data['provenance']['rendering'] = {'streetCoordinates': 'OpenStreetMap projected without geographic rearrangement', 'buildingFootprints': 'OpenStreetMap mapped footprints only; coverage is incomplete', 'facades': 'procedural visual interpretation, not surveyed', 'heights': 'heightSource stored for each building', 'roadWidths': 'widthSource stored for each road', 'waterCollision': 'mapped river minus playable bridge deck buffers; water geometry unchanged'}
    data['provenance']['rendering']['inferredFrontage'] = 'Separate inferredBuildings array; only vacant lots on Al Mashaya/Al Gomhouria corridor; rejects mapped footprints, road setbacks, water, parks and campus. Not a surveyed building database.'
    data['provenance']['rendering']['landuseClipping'] = 'Rendered landuse polygons are clipped against the mapped water multipolygon so broad landuse boundaries do not occlude the river; original source boundaries remain in the raw OSM snapshot.'
    data['stats'] = {'roadWays': len(segments), 'roadNodes': len({p['nodeId'] for s in segments for p in s['points']}), 'buildings': len(buildings), 'inferredFrontageBuildings': len(inferred), 'measuredHeightBuildings': sum(b['heightSource'] == 'OSM height' for b in buildings), 'waterPolygons': len(water), 'pois': len(pois), 'disconnectedRoads': len(disconnected)}
    return data


if __name__ == '__main__':
    path = ROOT / 'assets' / 'mansoura-map.json'
    data = normalize(json.loads(path.read_text(encoding='utf-8')))
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(data['stats'], indent=2))
