"""Writes the triangle count of every object model into public/maps/assets/catalog.json.

    python -I tools/map-assets/count_triangles.py public/maps/assets

Reads only the JSON chunk of each GLB (accessor counts stay readable under
meshopt compression): the triangles of every mesh the default scene draws,
once per node that uses it. Sets `triangles` on each object with a model and
on each of its `lod` entries; the editor's scene cost reads them
(src/app/world/custom-map/render/objects/scene-cost.ts). update_catalog.py
runs it after writing the objects.
"""
import json
import os
import struct
import sys


def glb_json(path):
    with open(path, 'rb') as f:
        magic, _version, _length = struct.unpack('<4sII', f.read(12))
        if magic != b'glTF':
            raise SystemExit(f'{path}: not a GLB')
        size, kind = struct.unpack('<II', f.read(8))
        if kind != 0x4E4F534A:
            raise SystemExit(f'{path}: first chunk is not JSON')
        return json.loads(f.read(size))


def triangles(path):
    g = glb_json(path)

    def mesh(m):
        n = 0
        for p in g['meshes'][m]['primitives']:
            if p.get('mode', 4) != 4:
                continue
            index = p.get('indices')
            n += g['accessors'][index if index is not None else p['attributes']['POSITION']]['count'] // 3
        return n

    def walk(k):
        node = g['nodes'][k]
        n = mesh(node['mesh']) if 'mesh' in node else 0
        return n + sum(walk(c) for c in node.get('children', []))

    return sum(walk(k) for k in g['scenes'][g.get('scene', 0)]['nodes'])


def main(out):
    path = os.path.join(out, 'catalog.json')
    catalog = json.load(open(path, encoding='utf8'))
    for o in catalog['objects']:
        o.pop('triangles', None)
        if not o.get('file'):
            continue
        # Right after `file`, where a reader looks for what the model is
        entry = {}
        for k, v in o.items():
            entry[k] = v
            if k == 'file':
                entry['triangles'] = triangles(os.path.join(out, o['file']))
        o.clear()
        o.update(entry)
        for lod in o.get('lod', []):
            lod['triangles'] = triangles(os.path.join(out, lod['file']))
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1])
