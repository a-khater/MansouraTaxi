"""Cache named OSM places for the requested Mansoura destination expansion."""
import datetime
import json
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/source/mansoura-destinations-osm.json'
QUERY = '''[out:json][timeout:60];
(
 nwr[amenity=hospital](31.015,31.34,31.07,31.415);
 nwr[name~"جزيرة الورد|جزيره الورد|الحوار|توريل|توريال|Touril|Toreil|Hewar|Hawar|Gezira",i](31.015,31.34,31.07,31.415);
);
out tags center;'''

if not TARGET.exists():
    failures = []
    for endpoint in ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']:
        request = urllib.request.Request(endpoint + '?' + urllib.parse.urlencode({'data': QUERY}),
            headers={'User-Agent': 'MansouraTaxi/0.3 offline destination research'})
        try:
            with urllib.request.urlopen(request, timeout=55) as response:
                result = json.load(response)
            break
        except Exception as error:
            failures.append(str(error))
    else:
        raise RuntimeError('; '.join(failures))
    if 'elements' not in result:
        raise RuntimeError('Overpass did not return a place extract.')
    result['_acquisition'] = {'query': QUERY, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                              'endpoint': request.full_url, 'license': 'ODbL-1.0'}
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
result = json.loads(TARGET.read_text(encoding='utf-8'))
for item in result['elements']:
    tags = item.get('tags', {})
    center = item.get('center', item)
    print(json.dumps({'type': item['type'], 'id': item['id'], 'name': tags.get('name'),
        'nameEn': tags.get('name:en'), 'lat': center.get('lat'), 'lon': center.get('lon'),
        'kind': tags.get('amenity', tags.get('place', tags.get('leisure', tags.get('club'))))}, ensure_ascii=False))
