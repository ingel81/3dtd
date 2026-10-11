/**
 * "How to build a good TD level": short rules of thumb for the help, each
 * with the tool that does it. Plain text, no claims the editor cannot back:
 * the check, the measure tool and the bot test give the numbers.
 */
import type { ToolId } from '../../tools/tool';

export interface GuideTopic {
  id: string;
  title: string;
  text: string;
  /** The tool the topic's button opens, and the button's words */
  tool?: ToolId;
  action?: string;
}

export const LEVEL_GUIDE: readonly GuideTopic[] = [
  {
    id: 'length',
    title: 'Route length',
    text:
      'Towers need time to work: a longer route gives them more shots at each enemy. Measure (D) shows each lane\'s length and how long the slowest and fastest enemies walk it. Very short lanes end waves before towers can hold them; very long ones make the map slow.',
    tool: 'measure',
    action: 'Measure the lanes',
  },
  {
    id: 'chokes',
    title: 'Choke points',
    text:
      'Curves, switchbacks and bridges bring the road past one spot several times. A tower there covers more road. Give the map a few such places, not one that decides everything.',
    tool: 'paths',
    action: 'Edit the roads',
  },
  {
    id: 'build',
    title: 'Room to build',
    text:
      'Towers stand on free ground beside the road; objects that block building take that room away. Leave open strips along the route where towers can stand, and look with the trial wave (P) where enemies pass.',
    tool: 'terrain',
    action: 'Level the ground',
  },
  {
    id: 'sight',
    title: 'Lines of sight',
    text:
      'Towers shoot only at what they see. Houses, trees, rocks and cliffs between a tower and the road block it. Each object has a "Blocks sight" switch; use cover to make places worth choosing, not to hide the whole route.',
    tool: 'objects',
    action: 'Check the objects',
  },
  {
    id: 'lanes',
    title: 'Number of lanes',
    text:
      'Every spawn is a lane. Two or three lanes that meet before the HQ let a player defend at the junction; many separate lanes split the defence and make a map much harder. For one player on many lanes, the gameplay rules can scale each lane down.',
    tool: 'markers',
    action: 'Place spawns',
  },
  {
    id: 'test',
    title: 'Test it',
    text:
      'Check (V) finds roads that do not reach the HQ. The bot test in the check plays the first waves on its own and says whether they held. Test map plays it yourself.',
  },
];
