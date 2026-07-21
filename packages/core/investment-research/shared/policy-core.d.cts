export declare const POLICY_CORE_VERSION: string;
export declare const RESEARCH_MODES: readonly string[];
export declare const RESEARCH_STATES: readonly string[];
export declare const RESEARCH_STATE_TRANSITIONS: Readonly<Record<string, readonly string[]>>;
export declare const STATE_CAPABILITIES: Readonly<Record<string, readonly string[]>>;
export declare const FRESHNESS_RULES: Readonly<Record<string, { maxAgeHours?: number; staleAction: string }>>;
export declare const MANDATE_CRITICAL_FIELDS: readonly string[];
export declare const RETRYABLE_STATES: Readonly<Record<string, number>>;

export interface ModePolicyData {
  id: string;
  version: string;
  memory: {
    useUserPreferences: boolean;
    usePreviousCandidates: boolean;
    useWatchlistAsSeed: boolean;
    usePreviousRecommendationsAsEvidence: boolean;
  };
  requiredStates: readonly string[];
  forbiddenShortcuts: readonly string[];
  finalDecision: {
    requireMandateForPersonalizedRecommendation: boolean;
    requireUniverse: boolean;
    requirePrimaryEvidence: boolean;
    requireCounterThesis: boolean;
    requireRiskAnalysis: boolean;
    requireValuationAssumptions: boolean;
    minEvidenceConfidenceForBuy: number;
  };
}

export declare const MODE_POLICY_DATA: Readonly<Record<string, ModePolicyData>>;

export declare function normalizeResearchText(text: string): string;
export declare function detectResearchMode(message: string): string;
export declare function isTransitionAllowed(fromState: string, toState: string): boolean;
export declare function validateStateSequence(states: readonly string[]): { valid: boolean; violations: string[] };
export declare function isCapabilityAllowed(state: string, capability: string): boolean;
export declare function evaluateFreshness(input: {
  dataCategory?: string;
  freshnessStatus?: string;
  ageHours?: number;
  newerVersionKnown?: boolean;
  materiality?: string;
}): { action: 'ALLOW' | 'WARN' | 'BLOCK'; reason: string };
export declare function evidenceFamilyKey(item: { contentHash?: string; publisher?: string; title?: string }): string;
export declare function countIndependentSources(items: ReadonlyArray<{ contentHash?: string; publisher?: string; title?: string }>): number;
