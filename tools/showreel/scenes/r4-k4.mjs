// K4 "Oder lass die KI bauen" (DREHBUCH_R4 2.5): an AI agent builds a castle with a moat while the editor shows it,
// its agent band reading "Claude Code" and each call. No language model in the take: the relay
// (tools/showreel/agent/relay.mjs, started beside the dev server) runs the desktop app's own MCP server and replays
// the recorded calls of fixtures/agent-castle.json over MCP: map_summary, run_script as a dry run, run_script.
// The request line ("request" in the fixture) goes over the picture in the cut, at the mark `request`.
//
// Map: Demo Valley's own copy, the castle on the west meadow (a stand-in until Stillwater's F-B9 copy exists; then
// MAP and the script's C change, the rest stays).
import { act, m, wait } from './common.mjs';

/** The relay's page socket (relay.mjs --ws) */
export const AGENT_WS = 47190;
const MAP = 'demo-valley';
/** The castle's middle (agent-castle.js C) */
const C = [-185, 0];

const frame = (points, opts = {}) => ({ do: 'frame', points, ...opts });
const around = (r) => [m(C[0] - r, C[1]), m(C[0] + r, C[1]), m(C[0], C[1] - r), m(C[0], C[1] + r)];

export const SCENES = [
  {
    name: 'ai-agent',
    page: `/editor?map=${MAP}&agent=${AGENT_WS}`,
    steps: [
      act('viewReady', { timeout: 90 }),
      // The map big, without the editor's frame and its markers; the band stays (it lies over the view)
      { do: 'ui', on: false },
      act('overlay', { on: false }),
      { do: 'cursor', show: false },
      frame(around(46), { from: 35, pitch: 34, margin: 0, glide: 0.1 }),
      // Warm-up: the castle's models load and compile once, then go (undo), and the switch off and on forgets the agent
      act('agent', { replay: 'castle-warm', reset: true }),
      act('idle', { timeout: 30 }),
      wait(1.5),
      { do: 'mark', name: 'AI agent' },
      wait(1),
      { do: 'mark', name: 'request' },
      // The agent reads the map, tries the script on a copy, then runs it: the castle grows step by step
      act('agent', { replay: 'castle', label: 'agent' }),
      act('idle', { timeout: 30 }),
      { do: 'mark', name: 'effect:castle' },
      // The result held while the camera turns a little round it
      frame(around(50), { from: 35, turn: 14, pitch: 34, margin: 4, glide: 0.1, dur: 4 }),
      // The step in the editor's history: "Agent: castle"
      { do: 'ui', on: true },
      { do: 'click', sel: '[data-test=side-history]', label: 'history' },
      wait(1.6),
    ],
  },
];
