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
export { generateFallbackWave, getWaveDifficulty } from './fallback-rules';
export {
  explainWaveDecision,
  formatExplanationForUI,
  getShortExplanation,
  type DecisionExplanation,
  type DecisionFactor,
} from './decision-explainer';
