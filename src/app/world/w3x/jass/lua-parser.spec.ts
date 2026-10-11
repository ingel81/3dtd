import type { W3Region } from '../formats/w3r';
import { regionVariable } from '../formats/w3r';
import { buildRouteGraph } from '../routes/route-graph';
import { routesFromEvaluation } from '../routes/script-routes';
import { wavesFromScript } from '../waves/wave-script';
import { JassEvaluator } from './jass-evaluator';
import { MAX_JASS_NESTING } from './jass-parser';
import { parseLua } from './lua-parser';

function region(name: string, x: number, y: number, size = 128): W3Region {
  const h = size / 2;
  return { name, variable: regionVariable(name), left: x - h, bottom: y - h, right: x + h, top: y + h, index: 0, weather: '' };
}

const REGIONS = [region('Spawn A', 0, 2000, 256), region('Spawn B', 1000, 2000, 256), region('Turn', 0, 0), region('Castle', 1000, -1000, 384)];

function names(g: ReturnType<typeof buildRouteGraph>): string[] {
  const byId = new Map(g!.nodes.map((n) => [n.id, n.name]));
  return g!.edges.map((e) => `${byId.get(e.from)} > ${byId.get(e.to)}`).sort();
}

/** What the World Editor writes for GUI triggers in Lua mode */
const GUI_LUA = `
gg_rct_Spawn_A = nil
gg_rct_Spawn_B = nil
gg_rct_Turn = nil
gg_rct_Castle = nil
gg_trg_A = nil
gg_trg_B = nil
gg_trg_Turn = nil
udg_Lives = 0
function InitGlobals()
    udg_Lives = 20
end

function CreateRegions()
    local we
    gg_rct_Spawn_A = Rect(-128.0, 1872.0, 128.0, 2128.0)
    gg_rct_Spawn_B = Rect(872.0, 1872.0, 1128.0, 2128.0)
    gg_rct_Turn = Rect(-64.0, -64.0, 64.0, 64.0)
    gg_rct_Castle = Rect(808.0, -1192.0, 1192.0, -808.0)
end

function Trig_A_Actions()
    IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Turn))
end

function InitTrig_A()
    gg_trg_A = CreateTrigger()
    TriggerRegisterEnterRectSimple(gg_trg_A, gg_rct_Spawn_A)
    TriggerAddAction(gg_trg_A, Trig_A_Actions)
end

function Trig_B_Actions()
    IssuePointOrder(GetEnteringUnit(), "attack", GetRectCenterX(gg_rct_Castle), GetRectCenterY(gg_rct_Castle))
end

function InitTrig_B()
    gg_trg_B = CreateTrigger()
    TriggerRegisterEnterRectSimple(gg_trg_B, gg_rct_Spawn_B)
    TriggerAddAction(gg_trg_B, Trig_B_Actions)
end

function Trig_Turn_Actions()
    IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Castle))
end

function InitTrig_Turn()
    gg_trg_Turn = CreateTrigger()
    TriggerRegisterEnterRectSimple(gg_trg_Turn, gg_rct_Turn)
    TriggerAddAction(gg_trg_Turn, Trig_Turn_Actions)
end

function InitCustomTriggers()
    InitTrig_A()
    InitTrig_B()
    InitTrig_Turn()
end

function main()
    SetCameraBounds(-3328.0, -3584.0, 3328.0, 3072.0, -3328.0, 3072.0, 3328.0, -3584.0)
    InitGlobals()
    CreateRegions()
    InitCustomTriggers()
end

function config()
    SetMapName("TRIGSTR_001")
end
`;

/** Hand-written Lua: rects in tables, loops over them, a closure for the timer */
const TABLE_LUA = `
--[[ the lanes,
     kept in tables ]]
local rects = {}
Next = __jarray(nil)
local function setRegions()
    rects = { gg_rct_Spawn_A, gg_rct_Spawn_B, gg_rct_Turn, [0] = gg_rct_Castle }
end

function Fill()
    for i = 1, 2 do
        Next[i] = GetRectCenter(rects[i + 2 > 3 and 0 or 3])
    end
end

function Move_Spawn()
    if GetOwningPlayer(GetTriggerUnit()) ~= Player(0) then
        IssuePointOrderLocBJ(GetTriggerUnit(), "move", Next[1])
    end
end

function Move_Turn()
    IssuePointOrderLoc(GetTriggerUnit(), "move", Next[2])
end

function main()
    gg_rct_Spawn_A = Rect(-128.0, 1872.0, 128.0, 2128.0)
    gg_rct_Spawn_B = Rect(872.0, 1872.0, 1128.0, 2128.0)
    gg_rct_Turn = Rect(-64.0, -64.0, 64.0, 64.0)
    gg_rct_Castle = Rect(808.0, -1192.0, 1192.0, -808.0)
    TimerStart(CreateTimer(), 0.0, false, function()
        setRegions()
        Fill()
        local t = CreateTrigger()
        for _, r in ipairs(rects) do
            if r ~= gg_rct_Turn then TriggerRegisterEnterRectSimple(t, r) end
        end
        TriggerAddAction(t, Move_Spawn)
        local turn = CreateTrigger()
        TriggerRegisterEnterRectSimple(turn, rects[3])
        TriggerAddAction(turn, Move_Turn)
    end)
end
`;

describe('Lua map scripts', () => {
  it('evaluate GUI triggers like their JASS twins', () => {
    const p = parseLua(GUI_LUA);
    expect(p.warnings).toEqual([]);
    expect(p.functions.has('Trig_A_Actions')).toBe(true);
    const { raw, orders } = routesFromEvaluation({ language: 'lua', file: 'war3map.lua', text: GUI_LUA }, REGIONS);
    expect(orders).toBe(3);
    const g = buildRouteGraph(raw, 'script-eval');
    expect(names(g)).toEqual(['Spawn A > Turn', 'Spawn B > Castle', 'Turn > Castle']);
    expect(g!.end).toBe('gg_rct_Castle');
  });

  it('evaluate rects in tables, numeric and ipairs loops, local functions and a closure', () => {
    const p = parseLua(TABLE_LUA);
    expect(p.warnings).toEqual([]);
    const { raw } = routesFromEvaluation({ language: 'lua', file: 'war3map.lua', text: TABLE_LUA }, REGIONS);
    // rects[1..2] are the spawns (ipairs skips the turn), Next[1] the turn's centre, Next[2] the castle's
    expect(names(buildRouteGraph(raw, 'script-eval'))).toEqual(['Spawn A > Turn', 'Spawn B > Turn', 'Turn > Castle']);
  });

  it('read numbers, strings, comments and operators the Lua way', () => {
    const p = parseLua(`
x = 0x10 + 1.5e1 + .5
s = 'a\\'b' .. "c\\n" .. [==[long]==] -- comment
r = 7 // 2 + 7 % 3
q = 1 ~= 2 and not (2 < 1)
pick = (3 > 4) and "yes" or "no"
nothing = not nil
u = FourCC("hfoo")
`);
    expect(p.warnings).toEqual([]);
    const ev = new JassEvaluator(p);
    ev.runInit();
    expect(ev.globals.get('x')).toBe(31.5);
    expect(ev.globals.get('s')).toBe("a'bc\nlong");
    expect(ev.globals.get('r')).toBe(4);
    expect(ev.globals.get('q')).toBe(true);
    expect(ev.globals.get('pick')).toBe('no');
    expect(ev.globals.get('nothing')).toBe(true);
    expect(ev.globals.get('u')).toBe(0x68666f6f);
  });

  it('keeps locals apart from globals of the same name, shadowing included', () => {
    const p = parseLua(`
n = 1
function main()
    local n = 5
    do
        local n = 7
        Inner = n
    end
    Outer = n
    for n = 1, 3 do Last = n end
    AfterLoop = n
end
`);
    const ev = new JassEvaluator(p);
    ev.runInit();
    expect([ev.globals.get('Inner'), ev.globals.get('Outer'), ev.globals.get('Last'), ev.globals.get('AfterLoop'), ev.globals.get('n')]).toEqual([7, 5, 3, 5, 1]);
  });

  it('runs while, repeat and break, and stops endless loops at the limit', () => {
    const p = parseLua(`
a = 0
b = 0
c = 0
function main()
    while a < 3 do a = a + 1 end
    repeat b = b + 2 until b >= 6
    while true do
        c = c + 1
        if c == 4 then break end
    end
    while true do end
end
`);
    const ev = new JassEvaluator(p, { maxLoop: 100 });
    ev.runInit();
    expect([ev.globals.get('a'), ev.globals.get('b'), ev.globals.get('c')]).toEqual([3, 6, 4]);
    expect(ev.warnings.join()).toMatch(/iteration limit/);
  });

  it('drops a function that does not parse and keeps the rest', () => {
    const p = parseLua(`
function Broken()
    if x then
        y = = 3
    end
end
function Fine(v)
    return v * 2
end
`);
    expect(p.warnings.length).toBe(1);
    expect([...p.functions.keys()]).toEqual(['Fine']);
  });

  it('holds the JASS limits against hostile scripts', () => {
    const deep = `${'('.repeat(20000)}1${')'.repeat(20000)}`;
    const p = parseLua(`function Deep() return ${deep} end\nfunction Fine() return 2 end\n`);
    expect(p.warnings.join()).toMatch(new RegExp(`nested deeper than ${MAX_JASS_NESTING}`));
    expect([...p.functions.keys()]).toEqual(['Fine']);

    const grow = parseLua(`s = "ab"\nfunction main()\n  while true do s = s .. s end\nend\n`);
    const ev = new JassEvaluator(grow, { maxLoop: 40 });
    expect(() => ev.runInit()).not.toThrow();
    expect(ev.globals.get('s')).toEqual({ kind: 'unknown' });
  });

  it('give their wave arrays to the wave reader', () => {
    const p = parseLua(`
udg_Unit = __jarray(0)
udg_Count = __jarray(0)
udg_Level = 0
function Setup()
    udg_Unit[1] = FourCC("h000")
    udg_Count[1] = 20
    udg_Unit[2] = FourCC("h001")
    udg_Count[2] = 15
end
function Spawn()
    CreateNUnitsAtLoc(udg_Count[udg_Level], udg_Unit[udg_Level], Player(11), GetRectCenter(gg_rct_A), bj_UNIT_FACING)
end
function main()
    Setup()
end
`);
    const waves = wavesFromScript(p)!;
    expect(waves.waves).toEqual([
      { wave: 1, unit: 'h000', count: 20 },
      { wave: 2, unit: 'h001', count: 15 },
    ]);
  });
});
