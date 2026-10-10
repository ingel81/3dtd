# Design system for Claude Design

`build.mjs` writes the files of the 3DTD design system as Claude Design reads them, from the repository:

| Source | Becomes |
|---|---|
| `src/app/styles/td-theme.ts` (`TD_CSS_VARS`, `TD_TYPE`) | `tokens.json` (colours, shadows, spacing, radius, sizes, opacity, stacking, type styles) and a first `tokens.css` |
| the built global stylesheet (`dist/3DTD/browser/styles-*.css`) | `components/bundle.css`: the `td-*` classes as the game ships them, plus the variables the token format cannot hold (texture surfaces, gradients, font stacks, durations) |
| the token tables of `docs/DESIGN_SYSTEM.md` | the usage note of each token |
| `components/icon/icon.component.ts` | the icons inside the component previews |
| `brand-book.md`, `cover.html` (here) | the brand book and the cover |
| the Barlow Semi Condensed and JetBrains Mono files of the build | `fonts/` |

The component cards (one preview and one guideline each) are written in `build.mjs`; a new `td-*` class gets a card
there.

## Rebuild

1. `npm run build` (the stylesheet and fonts come from `dist/`).
2. `node tools/design-system/build.mjs`. It writes `tmp/design-system/project/…`. Optional: `DS_REF` (the commit or
   branch named as source), `DS_NOTE` (the change note).
3. Publish the changed files under `tmp/design-system/` to the design system, `project/design-system.json` last.

The address of the design system and the ids of its uploaded logos and textures stay out of the repository, in
`tmp/design-system.config.json`:

```json
{ "url": "<design system link>", "blobs": { "logo": "/_blob/<id>", "logoSquare": "/_blob/<id>", "plaster": "/_blob/<id>", "basalt": "/_blob/<id>" } }
```

A changed logo or texture is uploaded again and its id updated there.
