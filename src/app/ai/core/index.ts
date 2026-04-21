// AI Core - Public API
// These are always available (production + dev)

// Models
export * from './models/game-state-snapshot';
export * from './models/wave-config';
export * from './models/wave-result';

// Services
export { AIDataCollectorService } from './ai-data-collector.service';
export { WaveDirectorService } from './wave-director.service';

// Utilities
export { analyzeDefense, analyzeVulnerabilities } from './defense-analyzer';
export { encodeGameState, ENCODED_STATE_SIZE, decodeFeatureNames } from './game-state-encoder';
export {
  TEMPLATES,
  NUM_ACTIVE_TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  STRENGTH_MIN,
  STRENGTH_MAX,
  COUNT_MIN,
  COUNT_MAX,
  getTemplate,
  getAvailableTemplateMask,
  type Template,
} from './templates';
export {
  explainWaveDecision,
  formatExplanationForUI,
  getShortExplanation,
  type DecisionExplanation,
  type DecisionFactor,
} from './decision-explainer';
