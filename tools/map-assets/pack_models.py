"""Compresses the raw GLBs of build_models.py for the game and measures them.

    python -I tools/map-assets/pack_models.py <glb-raw-dir> public/maps/assets [<id> ...]

Per model: gltf-transform optimize (meshopt geometry, WebP textures at 512 px,
1024 px for the ids in objects.json with `"textureSize": 1024`) into
<out>/models/<id>.glb, and its bounds and triangle count (read from the raw
GLB) into <glb-raw-dir>/report.json, which update_catalog.py turns into
footprint and height. Needs Node (npx @gltf-transform/cli).
"""
import json
import os
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    length = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + length])


def measure(path):
    """Bounds (glTF axes: y up) and triangles of all meshes; Blender exports with the transforms applied"""
    gltf = read_glb(path)
    lo = [1e9] * 3
    hi = [-1e9] * 3
    tris = 0
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            acc = gltf['accessors'][prim['attributes']['POSITION']]
            lo = [min(a, b) for a, b in zip(lo, acc['min'])]
            hi = [max(a, b) for a, b in zip(hi, acc['max'])]
            idx = prim.get('indices')
            count = gltf['accessors'][idx]['count'] if idx is not None else acc['count']
            tris += count // 3
    return {'min': lo, 'max': hi, 'tris': tris}


def main():
    raw, out, only = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    spec = {o['id']: o for o in json.load(open(os.path.join(HERE, 'objects.json'), encoding='utf8'))}
    report_path = os.path.join(raw, 'report.json')
    report = json.load(open(report_path, encoding='utf8')) if os.path.exists(report_path) else {}
    os.makedirs(os.path.join(out, 'models'), exist_ok=True)
    for name in sorted(os.listdir(raw)):
        if not name.endswith('.glb'):
            continue
        mid = name[:-4]
        if only and mid not in only:
            continue
        size = spec.get(mid, {}).get('textureSize', 512)
        target = os.path.join(out, 'models', name)
        subprocess.run(
            ['npx', '-y', '@gltf-transform/cli@4.5.1', 'optimize', os.path.join(raw, name), target,
             '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', str(size),
             '--simplify', 'false', '--instance', 'false', '--flatten', 'true', '--join', 'true',
             '--palette', 'false'],
            check=True, shell=os.name == 'nt', stdout=subprocess.DEVNULL)
        report[mid] = measure(os.path.join(raw, name))
        report[mid]['bytes'] = os.path.getsize(target)
        print(f'{mid:28s} {report[mid]["tris"]:7d} tris {report[mid]["bytes"] / 1024:8.0f} KB', file=sys.stderr)
    with open(report_path, 'w', encoding='utf8') as f:
        json.dump(report, f, indent=1)


main()
