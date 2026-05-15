"""Read the JSON chunk of a GLB binary and print material alphaMode info."""
import sys
import struct
import json


def read_glb_json(path):
    with open(path, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF':
            raise RuntimeError(f"Not a GLB: {magic}")
        version, total_length = struct.unpack('<II', f.read(8))
        # Read JSON chunk
        json_length, json_type = struct.unpack('<II', f.read(8))
        assert json_type == 0x4E4F534A, f"Expected JSON chunk, got {hex(json_type)}"
        json_bytes = f.read(json_length)
        return json.loads(json_bytes.decode('utf-8'))


def main():
    if len(sys.argv) < 2:
        print("Usage: read_glb_json.py <file.glb>")
        sys.exit(1)
    data = read_glb_json(sys.argv[1])
    mats = data.get('materials', [])
    print(f"=== {sys.argv[1]} ===")
    print(f"materials: {len(mats)}")
    for i, m in enumerate(mats):
        print(f"  [{i}] name={m.get('name')!r}")
        print(f"      alphaMode  = {m.get('alphaMode', '<default OPAQUE>')}")
        print(f"      alphaCutoff = {m.get('alphaCutoff', '<default 0.5>')}")
        print(f"      doubleSided = {m.get('doubleSided', False)}")
        pbr = m.get('pbrMetallicRoughness', {})
        print(f"      pbr.baseColorTexture = {pbr.get('baseColorTexture')}")
        print(f"      pbr.baseColorFactor  = {pbr.get('baseColorFactor')}")
    print(f"images: {len(data.get('images', []))}")
    for i, img in enumerate(data.get('images', [])):
        print(f"  [{i}] {img}")
    print(f"animations: {len(data.get('animations', []))}")
    for a in data.get('animations', []):
        print(f"  - {a.get('name')}")


main()
