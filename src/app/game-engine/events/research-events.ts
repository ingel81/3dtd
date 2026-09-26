/** Research: what happened and the commands (part of GameEvent, game-event-bus.ts). */


export type ResearchEvent =
  // ==================== Research Events ====================
  | {
      type: 'research:started';
      researchId: string;
      cost: number;
      duration: number;
      /** Whose research (docs/COOP_PLAN.md, D20) */
      playerId: string;
      /** The research of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      type: 'research:completed';
      researchId: string;
      effects: import('../../configs/research/research.types').ResearchEffect[];
      /** Whose research (docs/COOP_PLAN.md, D20) */
      playerId: string;
      /** The research of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      type: 'research:cancelled';
      researchId: string;
      refund: number;
      /** Whose research (docs/COOP_PLAN.md, D20) */
      playerId: string;
      /** The research of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // Snapshot-Event nach jeder ResearchManager-Mutation. Trägt den
      // vollen Active-/Completed-/Center-State, damit GameStateSyncService
      // ohne direktes ResearchManager-Polling den Store updaten kann.
      type: 'research:state-changed';
      activeResearches: import('../../configs/research/research.types').ActiveResearch[];
      completedResearches: Set<import('../../configs/research/research.types').ResearchId>;
      /** Waiting for a slot and the credits, in start order */
      queuedResearches: import('../../configs/research/research.types').ResearchId[];
      centerLevel: number;
      maxSlots: number;
      /** Whose research (docs/COOP_PLAN.md, D20) */
      playerId: string;
      /** The research of the player at this client, the one the UI shows */
      local: boolean;
    }
  | {
      // Laufender Fortschritt: vergangene Spielzeit (s) je aktiver Forschung.
      // Der ResearchManager drosselt auf 10 Hz Wanduhr.
      type: 'research:progress';
      elapsed: ReadonlyMap<import('../../configs/research/research.types').ResearchId, number>;
      /** Whose research (docs/COOP_PLAN.md, D20) */
      playerId: string;
      /** The research of the player at this client, the one the UI shows */
      local: boolean;
    }

  // ==================== Research Commands ====================
  | {
      type: 'command:start-research';
      researchId: string;
    }
  | {
      type: 'command:cancel-research';
      researchId: string;
    }
  | {
      // Player UI only: bots start researches with command:start-research,
      // which still refuses when every slot is busy.
      type: 'command:queue-research';
      researchId: string;
    }
  | {
      type: 'command:unqueue-research';
      researchId: string;
    }
  | {
      // Player UI only: reorder what is waiting. startQueued() works through
      // the queue in order, so this decides what starts next.
      type: 'command:move-queued-research';
      researchId: string;
      toIndex: number;
    };
