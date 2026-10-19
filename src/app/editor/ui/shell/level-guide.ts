/**
 * "How to build a good TD level": short rules of thumb for the help, each
 * with the tool that does it. Plain text, no claims the editor cannot back:
 * the check, the measure tool and the bot test give the numbers.
 */
import type { ToolId } from '../../tools/tool-defs';

/** A topic of the guide; its title, text and button words are the dictionary's (i18n `editor.guide`) */
export interface GuideTopic {
  id: 'length' | 'chokes' | 'build' | 'sight' | 'lanes' | 'test';
  /** The tool the topic's button opens */
  tool?: ToolId;
}

export const LEVEL_GUIDE: readonly GuideTopic[] = [
  {
    id: 'length',
    tool: 'measure',
  },
  {
    id: 'chokes',
    tool: 'paths',
  },
  {
    id: 'build',
    tool: 'terrain',
  },
  {
    id: 'sight',
    tool: 'objects',
  },
  {
    id: 'lanes',
    tool: 'markers',
  },
  {
    id: 'test',
  },
];
