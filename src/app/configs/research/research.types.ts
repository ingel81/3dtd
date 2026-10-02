/**
 * Research System Type Definitions
 *
 * Types for the tech-tree research system.
 * All research definitions use these types.
 */

import { TowerTypeId } from '../tower-types.config';

// ==================== Research Categories ====================

/**
 * `gate` opens other researches and does nothing else: a cheap first step that
 * gives a branch of the tree one trunk instead of several loose roots.
 */
export const RESEARCH_CATEGORIES = ['tower-unlock', 'global-perk', 'upgrade-tier', 'gate'] as const;
export type ResearchCategory = typeof RESEARCH_CATEGORIES[number];

// ==================== Research Branches ====================

/**
 * The strand of the tree a research belongs to. Purely how it reads: the tree
 * tints a node by it and the footer counts per strand. `category` says what a
 * research does, `branch` says where it lives.
 */
export const RESEARCH_BRANCHES = ['ballistics', 'arcane', 'biology', 'engineering'] as const;
export type ResearchBranch = typeof RESEARCH_BRANCHES[number];

export const RESEARCH_BRANCH_LABEL: Record<ResearchBranch, string> = {
  ballistics: 'Ballistics',
  arcane: 'Arcane',
  biology: 'Biology',
  engineering: 'Engineering',
};

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
  branch: ResearchBranch;
  icon: string;                    // Material icon name
  cost: number;                    // Credits
  duration: number;                // Seconds (real-time)
  prerequisites: ResearchId[];     // Must all be completed before this is available
  /**
   * First wave it may start in: from the build phase before that wave on
   * (researchWave). Spreads the tree over the run, gold alone did not: a
   * human run had all of it done by W26 for 1.3 % of its income.
   */
  minWave?: number;
  effects: ResearchEffect[];
}

/**
 * The wave a run is at for the research: the wave being played, else the next
 * one. A research of `minWave` N opens in the build phase before wave N.
 */
export function researchWave(waveNumber: number, phase: string): number {
  return phase === 'wave' ? waveNumber : waveNumber + 1;
}

/**
 * What `config` costs a player with `lanes` lanes: each lane pays its own kill gold, so research costs once per
 * lane and two lanes play like one spawn twice over, not like one spawn with half the research bill.
 */
export function researchCost(config: Pick<ResearchConfig, 'cost'>, lanes: number): number {
  return config.cost * Math.max(1, lanes);
}

/** The wave `config` waits for at `wave` (researchWave), null when it is open. */
export function researchWaitsForWave(config: Pick<ResearchConfig, 'minWave'>, wave: number): number | null {
  return config.minWave !== undefined && wave < config.minWave ? config.minWave : null;
}

// ==================== Active Research ====================

export interface ActiveResearch {
  researchId: ResearchId;
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
  /** Queue in start order; absent in states saved before the queue existed */
  queued?: ResearchId[];
}
