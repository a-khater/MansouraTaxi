"""Download a bounded OSM extract and preserve a reproducible meter projection.

Usage: python scripts/acquire_mansoura.py
OpenStreetMap contributors, ODbL 1.0. This script does not request map tiles.
"""
import datetime
import argparse
import json
import math
import pathlib
import urllib.parse
import urllib.request
from normalize_mansoura import normalize

ROOT = pathlib.Path(__file__).resolve().parents[1]
BBOX = [31.033, 31.350, 31.060, 31.398]  # south, west, north, east
ORIGIN = {"lat": 31.044, "lon": 31.375}
QUERY = """[out:json][timeout:120];
(
 way[highway](31.033,31.350,31.060,31.398);
 way[building](31.033,31.350,31.060,31.398);
 way[natural=water](31.033,31.350,31.060,31.398);
 relation[natural=water](31.033,31.350,31.060,31.398);
 way[waterway=riverbank](31.033,31.350,31.060,31.398);
 way[landuse](31.033,31.350,31.060,31.398);
 way[leisure](31.033,31.350,31.060,31.398);
 nwr[name][amenity](31.033,31.350,31.060,31.398);
 nwr[name][tourism](31.033,31.350,31.060,31.398);
);
out body geom;
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bbox', nargs=4, type=float, default=BBOX)
    parser.add_argument('--source', default='data/source/mansoura-osm-source.json')
    parser.add_argument('--output', default='assets/mansoura-map.json')
    args = parser.parse_args()
    bbox = args.bbox
    query = QUERY.replace('(31.033,31.350,31.060,31.398)', '(' + ','.join(map(str, bbox)) + ')')
    assets = ROOT / "assets"
    raw_path = ROOT / args.source
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    if raw_path.exists():
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        endpoint = raw.get("_acquisition", {}).get("endpoint", "cached Overpass extract")
        acquired = raw.get("_acquisition", {}).get("retrievedAt", "unknown")
    else:
        failures = []
        for endpoint in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
            try:
                print("Requesting", endpoint, flush=True)
                request = urllib.request.Request(endpoint + '?' + urllib.parse.urlencode({"data": query}), headers={"User-Agent": "MansouraTaxi/0.3 (bounded offline game extract)"})
                with urllib.request.urlopen(request, timeout=55) as response:
                    raw = json.load(response)
                if "elements" not in raw:
                    raise ValueError("Overpass returned no elements")
                acquired = datetime.datetime.now(datetime.timezone.utc).isoformat()
                raw["_acquisition"] = {"endpoint": endpoint, "retrievedAt": acquired, "query": query}
                raw_path.write_text(json.dumps(raw, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                break
            except Exception as error:
                failures.append(f"{endpoint}: {error}")
                print(failures[-1], flush=True)
        else:
            raise RuntimeError("; ".join(failures))

    def project(lat, lon):
        return {"x": round((lon - ORIGIN["lon"]) * 111320 * math.cos(math.radians(ORIGIN["lat"])), 3), "z": round((ORIGIN["lat"] - lat) * 111320, 3)}

    features = []
    for element in raw["elements"]:
        if "tags" not in element:
            continue
        geometry = element.get("geometry", [])
        item = {"osmType": element["type"], "osmId": element["id"], "tags": element["tags"]}
        if geometry:
            node_ids = element.get("nodes", [])
            item["points"] = [{**project(p["lat"], p["lon"]), **({"nodeId": node_ids[i]} if i < len(node_ids) else {})} for i, p in enumerate(geometry) if p]
        elif "lat" in element:
            item["point"] = project(element["lat"], element["lon"])
        elif "members" in element:
            item["members"] = []
            for member in element["members"]:
                member_geo = member.get("geometry", [])
                if member_geo:
                    item["members"].append({"role": member.get("role", ""), "osmId": member["ref"], "points": [project(p["lat"], p["lon"]) for p in member_geo if p]})
        features.append(item)
    west_south = project(bbox[0], bbox[1]); east_north = project(bbox[2], bbox[3])
    data = {
        "schemaVersion": 2,
        "provenance": {"source": "OpenStreetMap contributors", "sourceUrl": "https://www.openstreetmap.org/copyright", "license": "ODbL-1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/", "endpoint": endpoint, "retrievedAt": acquired, "osmBaseTimestamp": raw.get("osm3s", {}).get("timestamp_osm_base"), "bbox": bbox, "query": query, "sourceCache": args.source, "note": "Original OSM coordinates retained in raw source; projected data is a derived database. Missing building heights are explicitly inferred at render time. No claim of photorealistic or complete survey accuracy."},
        "projection": {"type": "local-equirectangular", "origin": ORIGIN, "metersPerLatitudeDegree": 111320, "metersPerLongitudeDegree": 111320 * math.cos(math.radians(ORIGIN["lat"])), "axes": {"x": "east", "z": "south"}},
        "bounds": {"minX": west_south["x"], "maxX": east_north["x"], "minZ": east_north["z"], "maxZ": west_south["z"]},
        "features": features,
    }
    data = normalize(data)
    path = ROOT / args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"bytes": path.stat().st_size, **data['stats']}, indent=2))


if __name__ == "__main__":
    main()
