import { existsSync, readFileSync } from 'fs';
import type { W3Region } from '../formats/w3r';
import { regionVariable } from '../formats/w3r';
import { JassEvaluator } from '../jass/jass-evaluator';
import { parseJass } from '../jass/jass-parser';
import { readW3xFiles } from '../map-files';
import { buildRouteGraph, routeLengths } from './route-graph';
import { routesFromEvaluation, routesFromPatterns, scriptRegions } from './script-routes';

const REAL_MAP = 'D:/Source/3dtd/tmp/wc3/Mafa-Td-Queen-v14.6.w3x';

function region(name: string, x: number, y: number, size = 128): W3Region {
  const h = size / 2;
  return { name, variable: regionVariable(name), left: x - h, bottom: y - h, right: x + h, top: y + h, index: 0, weather: '' };
}

const REGIONS = [
  region('Spawn A', 0, 2000, 256),
  region('Spawn B', 1000, 2000, 256),
  region('Turn', 0, 0),
  region('Castle', 1000, -1000, 384),
];

/** GUI-style code as the World Editor writes it: one trigger per rect */
const GUI_JASS = `
globals
    rect gg_rct_Spawn_A= null
    rect gg_rct_Spawn_B= null
    rect gg_rct_Turn= null
    rect gg_rct_Castle= null
    trigger gg_trg_A= null
    trigger gg_trg_B= null
    trigger gg_trg_Turn= null
    trigger gg_trg_Leak= null
    integer udg_Lives= 20
endglobals

function CreateRegions takes nothing returns nothing
    set gg_rct_Spawn_A=Rect(- 128.0, 1872.0, 128.0, 2128.0)
    set gg_rct_Spawn_B=Rect(872.0, 1872.0, 1128.0, 2128.0)
    set gg_rct_Turn=Rect(- 64.0, - 64.0, 64.0, 64.0)
    set gg_rct_Castle=Rect(808.0, - 1192.0, 1192.0, - 808.0)
endfunction

function Trig_A_Actions takes nothing returns nothing
    call IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Turn))
endfunction

function InitTrig_A takes nothing returns nothing
    set gg_trg_A=CreateTrigger()
    call TriggerRegisterEnterRectSimple(gg_trg_A, gg_rct_Spawn_A)
    call TriggerAddAction(gg_trg_A, function Trig_A_Actions)
endfunction

function Trig_B_Actions takes nothing returns nothing
    call IssuePointOrder(GetEnteringUnit(), "attack", GetRectCenterX(gg_rct_Castle), GetRectCenterY(gg_rct_Castle))
endfunction

function InitTrig_B takes nothing returns nothing
    set gg_trg_B=CreateTrigger()
    call TriggerRegisterEnterRectSimple(gg_trg_B, gg_rct_Spawn_B)
    call TriggerAddAction(gg_trg_B, function Trig_B_Actions)
endfunction

function Trig_Turn_Actions takes nothing returns nothing
    call IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Castle))
endfunction

function InitTrig_Turn takes nothing returns nothing
    set gg_trg_Turn=CreateTrigger()
    call TriggerRegisterEnterRectSimple(gg_trg_Turn, gg_rct_Turn)
    call TriggerAddAction(gg_trg_Turn, function Trig_Turn_Actions)
endfunction

function Trig_Leak_Actions takes nothing returns nothing
    set udg_Lives=( udg_Lives - 1 )
    call RemoveUnit(GetTriggerUnit())
endfunction

function InitTrig_Leak takes nothing returns nothing
    set gg_trg_Leak=CreateTrigger()
    call TriggerRegisterEnterRectSimple(gg_trg_Leak, gg_rct_Castle)
    call TriggerAddAction(gg_trg_Leak, function Trig_Leak_Actions)
endfunction

function InitCustomTriggers takes nothing returns nothing
    call InitTrig_A()
    call InitTrig_B()
    call InitTrig_Turn()
    call InitTrig_Leak()
endfunction

function main takes nothing returns nothing
    call CreateRegions()
    call InitCustomTriggers()
endfunction
`;

/** The same routes kept in arrays filled by a loop, as hand-written map code does */
const ARRAY_JASS = `
globals
    rect gg_rct_Spawn_A= null
    rect gg_rct_Spawn_B= null
    rect gg_rct_Turn= null
    rect gg_rct_Castle= null
    rect array udg_Rects
    location array udg_Next
    integer array Temp
    trigger udg_t1= null
    trigger udg_t2= null
endglobals

function SetRegions takes nothing returns nothing
    set udg_Rects[0]=gg_rct_Spawn_A
    set udg_Rects[1]=gg_rct_Spawn_B
    set udg_Rects[2]=gg_rct_Turn
    set udg_Rects[3]=gg_rct_Castle
endfunction

function Fill takes nothing returns nothing
 local integer i= 0
    loop
        exitwhen ( i > 1 )
        set Temp[0]=i + 2
        set udg_Next[i]=GetRectCenter(udg_Rects[Temp[0]])
        set i=i + 1
    endloop
endfunction

function Move_Spawn takes nothing returns nothing
    if ( GetOwningPlayer(GetTriggerUnit()) == Player(11) ) then
        call IssuePointOrderLocBJ(GetTriggerUnit(), "move", udg_Next[0])
    endif
endfunction

function Move_Turn takes nothing returns nothing
    call IssuePointOrderLoc(GetTriggerUnit(), "move", udg_Next[1])
endfunction

function Spawner takes nothing returns nothing
 local integer n= 0
    loop
        exitwhen n > 1
        call CreateNUnitsAtLoc(3, 'hfoo', Player(11), GetRectCenter(udg_Rects[n]), bj_UNIT_FACING)
        set n=n + 1
    endloop
endfunction

function Init takes nothing returns nothing
 local trigger t
    call SetRegions()
    call Fill()
    set udg_t1=CreateTrigger()
    call TriggerRegisterEnterRectSimple(udg_t1, udg_Rects[0])
    call TriggerRegisterEnterRectSimple(udg_t1, udg_Rects[1])
    call TriggerAddAction(udg_t1, function Move_Spawn)
    set t=CreateTrigger()
    call TriggerRegisterEnterRectSimple(t, udg_Rects[2])
    call TriggerAddAction(t, function Move_Turn)
    set udg_t2=CreateTrigger()
    call TriggerRegisterTimerEvent(udg_t2, 30.0, true)
    call TriggerAddAction(udg_t2, function Spawner)
endfunction

function main takes nothing returns nothing
    set gg_rct_Spawn_A=Rect(- 128.0, 1872.0, 128.0, 2128.0)
    set gg_rct_Spawn_B=Rect(872.0, 1872.0, 1128.0, 2128.0)
    set gg_rct_Turn=Rect(- 64.0, - 64.0, 64.0, 64.0)
    set gg_rct_Castle=Rect(808.0, - 1192.0, 1192.0, - 808.0)
    call TimerStart(CreateTimer(), 0.0, false, function Init)
endfunction
`;

function names(g: ReturnType<typeof buildRouteGraph>): string[] {
  const byId = new Map(g!.nodes.map((n) => [n.id, n.name]));
  return g!.edges.map((e) => `${byId.get(e.from)} > ${byId.get(e.to)}`).sort();
}

describe('JASS parser and evaluator', () => {
  it('parses expressions with JASS precedence and literals', () => {
    const p = parseJass(`
globals
    integer a= 2 + 3 * 4
    real b= - 1.5 * 2
    integer c= 'hfoo'
    integer d= $10 + 0x10 + 010
    boolean e= not 1 == 2 and true
    integer f= 7 / 2
    real g= 7.0 / 2
    string s= "a\\"b" + "c"
endglobals
`);
    expect(p.warnings).toEqual([]);
    const ev = new JassEvaluator(p);
    ev.runInit();
    expect(ev.globals.get('a')).toBe(14);
    expect(ev.globals.get('b')).toBe(-3);
    expect(ev.globals.get('c')).toBe(0x68666f6f);
    expect(ev.globals.get('d')).toBe(16 + 16 + 8);
    expect(ev.globals.get('e')).toBe(true);
    expect(ev.globals.get('f')).toBe(3);
    expect(ev.globals.get('g')).toBe(3.5);
    expect(ev.globals.get('s')).toBe('a"bc');
  });

  it('skips a function that does not parse and keeps the rest', () => {
    const p = parseJass(`
function Broken takes nothing returns nothing
    set = 3
endfunction
function Fine takes integer x returns integer
    return x * 2
endfunction
`);
    expect(p.warnings.length).toBe(1);
    expect([...p.functions.keys()]).toEqual(['Fine']);
  });

  it('stops endless loops at the iteration limit', () => {
    const p = parseJass(`
globals
    integer n= 0
endglobals
function main takes nothing returns nothing
    loop
        exitwhen false
        set n=n + 1
    endloop
endfunction
`);
    const ev = new JassEvaluator(p, { maxLoop: 100 });
    ev.runInit();
    expect(ev.globals.get('n')).toBe(100);
    expect(ev.warnings.join()).toMatch(/iteration limit/);
  });
});

describe('script routes', () => {
  it('(a) recognises GUI enter-rect triggers', () => {
    const raw = routesFromPatterns({ language: 'jass', file: 'war3map.j', text: GUI_JASS }, REGIONS);
    const g = buildRouteGraph(raw, 'script-pattern');
    expect(names(g)).toEqual(['Spawn A > Turn', 'Spawn B > Castle', 'Turn > Castle']);
    expect(g!.end).toBe('gg_rct_Castle');
    expect(g!.spawns.sort()).toEqual(['gg_rct_Spawn_A', 'gg_rct_Spawn_B']);
  });

  it('(a) reads the same pattern from Lua', () => {
    const lua = `
function Trig_A_Actions()
    IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Castle))
end

function InitTrig_A()
    gg_trg_A = CreateTrigger()
    TriggerRegisterEnterRectSimple(gg_trg_A, gg_rct_Spawn_A)
    TriggerAddAction(gg_trg_A, Trig_A_Actions)
end
`;
    const g = buildRouteGraph(routesFromPatterns({ language: 'lua', file: 'war3map.lua', text: lua }, REGIONS), 'script-pattern');
    expect(names(g)).toEqual(['Spawn A > Castle']);
  });

  it('(b) evaluates rect arrays, loops, conditions and timers', () => {
    const { raw, orders } = routesFromEvaluation({ language: 'jass', file: 'war3map.j', text: ARRAY_JASS }, REGIONS);
    expect(orders).toBe(2);
    const g = buildRouteGraph(raw, 'script-eval');
    expect(names(g)).toEqual(['Spawn A > Turn', 'Spawn B > Turn', 'Turn > Castle']);
    expect(g!.end).toBe('gg_rct_Castle');
    // Units are created in both spawn rects
    expect([...raw.spawnHints].sort()).toEqual(['gg_rct_Spawn_A', 'gg_rct_Spawn_B']);
  });

  it('(b) follows units ordered right after they are created', () => {
    const text = `
function Spawn takes nothing returns nothing
    call CreateNUnitsAtLoc(5, 'hfoo', Player(11), Location(0, 2000), bj_UNIT_FACING)
    call GroupPointOrderLocBJ(GetLastCreatedGroup(), "attack", Location(1000, -1000))
endfunction
function main takes nothing returns nothing
 local trigger t= CreateTrigger()
    call TriggerRegisterTimerEventPeriodic(t, 10.0)
    call TriggerAddAction(t, function Spawn)
endfunction
`;
    const g = buildRouteGraph(routesFromEvaluation({ language: 'jass', file: 'war3map.j', text }, REGIONS).raw, 'script-eval');
    expect(names(g)).toEqual(['Spawn A > Castle']);
  });

  it('reads region rects from the script when the map has no region file', () => {
    const rs = scriptRegions(GUI_JASS);
    expect(rs.map((r) => r.variable)).toEqual(['gg_rct_Spawn_A', 'gg_rct_Spawn_B', 'gg_rct_Turn', 'gg_rct_Castle']);
    expect(rs[0]).toMatchObject({ left: -128, bottom: 1872, right: 128, top: 2128 });
  });

  it.skipIf(!existsSync(REAL_MAP))('(b) finds the ten lanes of the test map', () => {
    const m = readW3xFiles(new Uint8Array(readFileSync(REAL_MAP)));
    expect(routesFromPatterns(m.script!, m.regions).edges.length).toBe(0);
    const g = buildRouteGraph(routesFromEvaluation(m.script!, m.regions).raw, 'script-eval')!;
    expect(g.spawns.length).toBe(10);
    expect(g.end).toBe('gg_rct_The_Throne');
    expect(g.edges.length).toBe(29);
    const lengths = [...routeLengths(g).values()].map(Math.round).sort((a, b) => a - b);
    expect(lengths).toEqual([10624, 10624, 14592, 14592, 15488, 15488, 20864, 20864, 20864, 20864]);
  });
});
