/**
 * Research System Type Definitions
 *
 * Types for the tech-tree research system.
 * All research definitions use these types.
 */

import { TowerTypeId } from '../tower-types.config';

// ==================== Research Categories ====================

export const RESEARCH_CATEGORIES = ['tower-unlock', 'global-perk', 'upgrade-tier'] as const;
export type ResearchCategory = typeof RESEARCH_CATEGORIES[number];

// ==================== Research ID ====================

/** Research IDs are plain strings for maximum extensibility. */
export type ResearchId = string;

// ==================== Research Effects ====================

/**
 * Discriminated union for research effects.
 * Each research can have one or more effects of different kinds.
 * Adding a new effect kind = adding a union member (consumers get compile warnings).
 */
export type ResearchEffect =
  | { kind: 'unlock-tower'; towerId: TowerTypeId }
  | { kind: 'global-perk'; perkId: string; description: string }
  | { kind: 'unlock-upgrade-tier'; tier: number }
  | { kind: 'enable-targeting'; capability: 'air' };

// ==================== Research Config ====================

export interface ResearchConfig {
  id: ResearchId;
  name: string;
  description: string;
  category: ResearchCategory;
  icon: string;                    // Material icon name
  cost: number;                    // Credits
  duration: number;                // Seconds (real-time)
  prerequisites: ResearchId[];     // Must all be completed before this is available
  effects: ResearchEffect[];
}

// ==================== Active Research ====================

export interface ActiveResearch {
  researchId: ResearchId;
  startTime: number;               // performance.now() when started
  duration: number;                // Total duration in seconds
  elapsed: number;                 // Seconds elapsed
  cost: number;                    // Credits paid (for refund on cancel)
}

// ==================== Research Save State ====================

export interface ResearchSaveState {
  completed: ResearchId[];
  active: { researchId: ResearchId; elapsed: number }[];
  slots: number;
  centerLevel: number;
}
