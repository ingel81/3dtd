#!/usr/bin/env node
/**
 * services/ subfolder split helper.
 *
 * Usage: node tools/split-services.mjs <subfolder> <name1> [<name2> ...]
 *
 * For each moved file (already in subfolder), rewrites internal import paths:
 *   - `from '../X'`         → `from '../../X'`         (one level deeper)
 *   - `from './<sibling>'`  → `from './<sibling>'`      (no change)
 *   - `from './<other>'`    → `from '../<other>'`       (back up to services/)
 *   - `from './<sub>/X'`    → `from '../<sub>/X'`       (debug/, combat/, etc.)
 *
 * Then updates *external* references across the whole repo:
 *   - `services/<name>.service` → `services/<subfolder>/<name>.service`
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep, resolve } from 'node:path';

const [, , subfolder, ...names] = process.argv;
if (!subfolder || names.length === 0) {
  console.error('Usage: node tools/split-services.mjs <subfolder> <name1> [<name2> ...]');
  process.exit(1);
}

const repoRoot = resolve(process.cwd());
const servicesDir = resolve(repoRoot, 'src/app/services');
const subDir = resolve(servicesDir, subfolder);

const siblingSet = new Set(names);

// --- Step 1: rewrite imports inside the moved files ---
const movedFiles = readdirSync(subDir)
  .filter(f => f.endsWith('.ts'))
  .filter(f => names.some(n => f === `${n}.service.ts` || f === `${n}.service.spec.ts`));

for (const file of movedFiles) {
  const path = join(subDir, file);
  let content = readFileSync(path, 'utf8');

  // Idempotency guard: if the file already starts with at least one `../../`
  // import (relative path of depth 2 or more), we've already rewritten this
  // file in a previous run and must not re-wrap.
  const alreadyRewritten = /from '\.\.\/\.\.\//.test(content);
  if (alreadyRewritten) {
    console.log(`Skipped (already rewritten): ${file}`);
    continue;
  }

  // Step 1a: imports that previously went up to app/ now need two ../.
  content = content.replace(/from '\.\.\//g, "from '../../");

  // Step 1b: local-service imports './X.service' or './X.service.<spec>'
  //   - If X is one of the sibling names → stays as './X.service'
  //   - Otherwise → '../X.service'
  content = content.replace(/from '\.\/([a-zA-Z0-9_-]+)(\.service(?:\.spec)?)'/g, (match, base, ext) => {
    if (siblingSet.has(base)) return match; // sibling — keep './'
    return `from '../${base}${ext}'`;
  });

  // Step 1c: subfolders that used to be siblings at services/ root now sit
  // one level up. Covers existing debug/, combat/ as well as any of the four
  // split targets (facade, infrastructure, location, world).
  content = content.replace(
    /from '\.\/(debug|combat|facade|infrastructure|location|world)\//g,
    "from '../$1/",
  );

  writeFileSync(path, content, 'utf8');
  console.log(`Updated internal imports: ${file}`);
}

// --- Step 2: rewrite external imports across the repo ---
// Two patterns:
//   `services/<name>.service`           — referenced from outside services/
//   `./<name>.service` inside services/ — referenced by a sibling that hasn't moved yet
const RG = /\bservices\/([a-zA-Z0-9_-]+)\.service\b/g;
const SIBLING_RG = /from '\.\/([a-zA-Z0-9_-]+)\.service'/g;

function walk(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    if (ent === 'node_modules' || ent === 'dist' || ent === '.git') continue;
    const full = join(dir, ent);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (ent.endsWith('.ts')) out.push(full);
  }
  return out;
}

const allTs = walk(resolve(repoRoot, 'src'));

const servicesRoot = `${sep}services${sep}`;
const subfolderPath = `${sep}services${sep}${subfolder}${sep}`;

let externalUpdates = 0;
for (const path of allTs) {
  // Skip files inside the subfolder itself — Step 1 already covered them.
  if (path.includes(subfolderPath)) continue;

  let content = readFileSync(path, 'utf8');
  let changed = false;

  content = content.replace(RG, (match, name) => {
    if (siblingSet.has(name)) {
      changed = true;
      return `services/${subfolder}/${name}.service`;
    }
    return match;
  });

  // Relative-path fixup for files INSIDE services/.
  // The relative prefix needed to reach a sibling file at services/ root
  // depends on where the *referencing* file sits:
  //   services/X.ts                    → './name.service'          (root)
  //   services/<other-sub>/X.ts        → '../name.service'         (one level)
  //
  // After the split, the moved file lives at services/<subfolder>/name.service,
  // so the same referencer needs:
  //   services/X.ts                    → './<subfolder>/name.service'
  //   services/<other-sub>/X.ts        → '../<subfolder>/name.service'
  const svcIdx = path.indexOf(servicesRoot);
  if (svcIdx !== -1) {
    const isServicesRoot = path.lastIndexOf(sep) === svcIdx + servicesRoot.length - 1;
    if (isServicesRoot) {
      content = content.replace(SIBLING_RG, (match, name) => {
        if (siblingSet.has(name)) {
          changed = true;
          return `from './${subfolder}/${name}.service'`;
        }
        return match;
      });
    } else {
      // File sits in services/<other-sub>/... — uses `../name.service` to
      // reach siblings at services/ root.
      content = content.replace(/from '\.\.\/([a-zA-Z0-9_-]+)\.service'/g, (match, name) => {
        if (siblingSet.has(name)) {
          changed = true;
          return `from '../${subfolder}/${name}.service'`;
        }
        return match;
      });
    }
  }

  if (changed) {
    writeFileSync(path, content, 'utf8');
    externalUpdates++;
    console.log(`Updated external imports: ${path}`);
  }
}

console.log(`Done. ${movedFiles.length} internal files + ${externalUpdates} external files updated.`);
