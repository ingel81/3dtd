"""The detail stages' tones (stage-tones.json, measured by stage_tones.mjs) into the catalogue: `lod[k].tone`,
`lod[k].materials` (a tone per LOD material, stage_tones.mjs --materials) and `far.tone` per object, as the game
reads them (asset-catalog.ts StageTone). update_catalog.py applies them too.

    python -I tools/map-assets/stage_tones.py public/maps/assets
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    with open(os.path.join(HERE, 'stage-tones.json'), encoding='utf8') as f:
        return json.load(f)


def apply(objects, tones):
    """Sets each object's stage tones from `tones` (by id), and drops those `tones` has none for"""
    for o in objects:
        t = tones.get(o['id'], {})
        for k, level in enumerate(o.get('lod', [])):
            tone = (t.get('lod') or [])[k] if k < len(t.get('lod') or []) else None
            if tone:
                level['tone'] = tone
            else:
                level.pop('tone', None)
            materials = (t.get('lodMaterials') or [])[k] if k < len(t.get('lodMaterials') or []) else None
            if materials:
                level['materials'] = materials
            else:
                level.pop('materials', None)
        if 'far' in o:
            if t.get('far'):
                o['far']['tone'] = t['far']
            else:
                o['far'].pop('tone', None)


def main():
    path = os.path.join(sys.argv[1], 'catalog.json')
    with open(path, encoding='utf8') as f:
        catalog = json.load(f)
    apply(catalog['objects'], load())
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')


if __name__ == '__main__':
    main()
