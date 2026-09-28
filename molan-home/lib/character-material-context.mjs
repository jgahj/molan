import context from './character-material-context.cjs';

export const {
  ARCHETYPE_WHITELIST,
  CONTEXT_WHITELIST,
  DIMENSION_WHITELIST,
  EMOTIONAL_STATE_WHITELIST,
  HUMAN_TEXTURE_SIGNAL_WHITELIST,
  INTENT_WHITELIST,
  RELATIONSHIP_WHITELIST,
  SCENE_WHITELIST,
  SCORE_WEIGHTS,
  extractGenerationContext,
  injectTop,
  rankMaterialCandidates,
} = context;

export default context;
