"""Compresses the raw GLBs of build_models.py for the game and measures them.

    python -I tools/map-assets/pack_models.py <glb-raw-dir> public/maps/assets [<id> ...]

Per model: gltf-transform optimize (meshopt geometry, textures as they come)
into <out>/models/<id>.glb, then tools/model-pack/pack-map-models.mjs: the
textures as KTX2 at 512 px (1024 px for the ids in objects.json with
`"textureSize": 1024`, half of that for their -lod1 copies), shared between
the models in <out>/textures/; its bounds and triangle count (read from the
raw GLB) into <glb-raw-dir>/report.json, which update_catalog.py turns into
footprint and height. Needs Node (npx @gltf-transform/cli, `npm install` in
tools/model-pack) and the ktx tool of KTX-Software 4.4 in KTX_TOOL.
"""
import json
import os
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, '..', 'model-pack')


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
    report_path = os.path.join(raw, 'report.json')
    report = json.load(open(report_path, encoding='utf8')) if os.path.exists(report_path) else {}
    os.makedirs(os.path.join(out, 'models'), exist_ok=True)
    for name in sorted(os.listdir(raw)):
        if not name.endswith('.glb'):
            continue
        mid = name[:-4]
        if only and mid not in only:
            continue
        target = os.path.join(out, 'models', name)
        # Textures stay as Blender wrote them: the KTX2 step below sizes and encodes them once
        subprocess.run(
            ['npx', '-y', '@gltf-transform/cli@4.5.1', 'optimize', os.path.join(raw, name), target,
             '--compress', 'meshopt', '--texture-compress', 'false',
             '--simplify', 'false', '--instance', 'false', '--flatten', 'true', '--join', 'true',
             '--palette', 'false'],
            check=True, shell=os.name == 'nt', stdout=subprocess.DEVNULL)
        # A textured LOD (blender_kit.export_lod textured=True) is seen from afar: pack-map-models.mjs gives it half the size
        subprocess.run(['node', os.path.join(PACK, 'pack-map-models.mjs'), out, mid], check=True)
        report[mid] = measure(os.path.join(raw, name))
        report[mid]['bytes'] = os.path.getsize(target)
        print(f'{mid:28s} {report[mid]["tris"]:7d} tris {report[mid]["bytes"] / 1024:8.0f} KB', file=sys.stderr)
    with open(report_path, 'w', encoding='utf8') as f:
        json.dump(report, f, indent=1)


main()
