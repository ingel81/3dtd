/**
 * Routes from the map script.
 *
 * (a) `routesFromPatterns`: the code the World Editor generates for GUI
 * triggers, matched as text, so it works for JASS and Lua alike:
 * `TriggerRegisterEnterRectSimple(trg, gg_rct_A)` + `TriggerAddAction(trg,
 * F)` where F orders the entering unit to `GetRectCenter(gg_rct_B)` (or to
 * its X/Y) with "move", "attack", "smart" or "patrol" gives the edge A -> B.
 *
 * (b) `routesFromEvaluation`: runs the JASS init with `JassEvaluator`, which
 * resolves rects and locations kept in variables and arrays, then collects
 * the point orders of every trigger.
 */

import type { W3Region } from '../formats/w3r';
import { JassEvaluator, type LocValue, type RectValue } from '../jass/jass-evaluator';
import { parseJass } from '../jass/jass-parser';
import type { MapScript } from '../map-files';
import {
  LEAK_ACTION,
  type RawRoutes,
  emptyRaw,
  functionBodies,
  pointNode,
  regionNode,
} from './route-graph';

const NUM = String.raw`(-?\s*[\d.]+)`;

/** Regions defined in the script (`gg_rct_X = Rect(...)`), for maps whose w3r is missing */
export function scriptRegions(script: string): W3Region[] {
  const re = new RegExp(String.raw`(gg_rct_\w+)\s*=\s*Rect\(\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*\)`, 'g');
  const out: W3Region[] = [];
  const n = (s: string): number => parseFloat(s.replace(/\s+/g, ''));
  for (let m = re.exec(script); m; m = re.exec(script)) {
    out.push({
      name: m[1].slice(7).replace(/_/g, ' '),
      variable: m[1],
      left: n(m[2]),
      bottom: n(m[3]),
      right: n(m[4]),
      top: n(m[5]),
      index: out.length,
      weather: '',
    });
  }
  return out;
}

const ORDER = String.raw`"(?:move|attack|smart|patrol)"`;
const UNIT = String.raw`(?:GetTriggerUnit|GetEnteringUnit)\(\s*\)`;

export function routesFromPatterns(script: MapScript, regions: W3Region[]): RawRoutes {
  const raw = emptyRaw();
  const text = script.text;
  const byVar = new Map(regions.map((r) => [r.variable, r]));
  const bodies = functionBodies(text);

  const enter = new Map<string, string[]>();
  const enterRe = /TriggerRegisterEnterRectSimple\(\s*(\w+)\s*,\s*(gg_rct_\w+)\s*\)/g;
  for (let m = enterRe.exec(text); m; m = enterRe.exec(text)) {
    (enter.get(m[1]) ?? enter.set(m[1], []).get(m[1])!).push(m[2]);
  }
  const actions = new Map<string, string[]>();
  const actionRe = /TriggerAddAction\(\s*(\w+)\s*,\s*(?:function\s+)?(\w+)\s*\)/g;
  for (let m = actionRe.exec(text); m; m = actionRe.exec(text)) {
    (actions.get(m[1]) ?? actions.set(m[1], []).get(m[1])!).push(m[2]);
  }
  const orderLoc = new RegExp(String.raw`Issue\w*PointOrder\w*\(\s*${UNIT}\s*,\s*${ORDER}\s*,\s*GetRectCenter\(\s*(gg_rct_\w+)\s*\)`, 'g');
  const orderXY = new RegExp(
    String.raw`IssuePointOrder\(\s*${UNIT}\s*,\s*${ORDER}\s*,\s*GetRectCenterX\(\s*(gg_rct_\w+)\s*\)\s*,\s*GetRectCenterY\(\s*gg_rct_\w+\s*\)\s*\)`,
    'g',
  );

  for (const [trg, rects] of enter) {
    const body = (actions.get(trg) ?? []).map((f) => bodies.get(f) ?? '').join('\n');
    const targets: string[] = [];
    for (const re of [orderLoc, orderXY]) {
      re.lastIndex = 0;
      for (let m = re.exec(body); m; m = re.exec(body)) targets.push(m[1]);
    }
    for (const from of rects) {
      const a = byVar.get(from);
      if (!a) continue;
      const fromId = regionNode(raw, a);
      if (targets.length === 0 && LEAK_ACTION.test(body)) raw.endHints.add(fromId);
      for (const to of targets) {
        const b = byVar.get(to);
        if (b) raw.edges.push({ from: fromId, to: regionNode(raw, b) });
      }
    }
  }

  // Units created at a rect centre mark spawns
  const createRe = /Create\w*Unit\w*\([^\n]*?GetRectCenter\(\s*(gg_rct_\w+)\s*\)/g;
  for (let m = createRe.exec(text); m; m = createRe.exec(text)) {
    const r = byVar.get(m[1]);
    if (r) raw.creationHints.add(regionNode(raw, r));
  }
  return raw;
}

export interface EvaluationResult {
  raw: RawRoutes;
  warnings: string[];
  orders: number;
}

export function routesFromEvaluation(script: MapScript, mapRegions: W3Region[]): EvaluationResult {
  const raw = emptyRaw();
  const regions = [...mapRegions];
  const program = parseJass(script.text);
  const ev = new JassEvaluator(program);
  ev.runInit();
  ev.collectOrders();
  const warnings = [...program.warnings.slice(0, 5), ...ev.warnings];
  if (program.warnings.length > 5) warnings.push(`script: ${program.warnings.length - 5} more parse warnings`);
  const bodies = functionBodies(script.text);

  const byVar = new Map(regions.map((r) => [r.variable, r]));
  const regionOf = (r: RectValue): W3Region => {
    const named = r.variable ? byVar.get(r.variable) : undefined;
    if (named) return named;
    const same = regions.find(
      (g) => Math.abs(g.left - r.left) < 1 && Math.abs(g.bottom - r.bottom) < 1 && Math.abs(g.right - r.right) < 1 && Math.abs(g.top - r.top) < 1,
    );
    if (same) return same;
    // A rect only the script knows
    const variable = r.variable ?? `rect_${r.id}`;
    const made: W3Region = {
      name: variable.replace(/^gg_rct_/, '').replace(/_/g, ' '),
      variable,
      left: r.left,
      bottom: r.bottom,
      right: r.right,
      top: r.top,
      index: -1,
      weather: '',
    };
    regions.push(made);
    byVar.set(variable, made);
    return made;
  };
  const locNode = (l: LocValue): string => (l.rect ? regionNode(raw, regionOf(l.rect)) : pointNode(raw, regions, l.x, l.y));

  for (const o of ev.orders) {
    const to = locNode(o.target);
    if (o.subject.origin === 'event') {
      for (const r of o.trigger.enterRects) raw.edges.push({ from: regionNode(raw, regionOf(r)), to });
    } else if (o.subject.at) {
      const from = locNode(o.subject.at);
      raw.spawnHints.add(from);
      raw.edges.push({ from, to });
    }
  }
  for (const c of ev.creations) raw.creationHints.add(locNode(c.at));
  for (const t of ev.triggers) {
    if (t.enterRects.length === 0) continue;
    const ordersHere = ev.orders.some((o) => o.trigger === t);
    const body = t.actions.map((f) => bodies.get(f) ?? '').join('\n');
    if (!ordersHere && LEAK_ACTION.test(body)) for (const r of t.enterRects) raw.endHints.add(regionNode(raw, regionOf(r)));
  }
  return { raw, warnings, orders: ev.orders.length };
}
