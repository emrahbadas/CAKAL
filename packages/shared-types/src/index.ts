// ============================
// Çakal Çekirdeği — Shared Types
// ============================

// --- Agent Types ---
export type AgentName =
  | 'commander'
  | 'hunter'
  | 'profile-keeper'
  | 'arbitrage'
  | 'street-hunter'
  | 'finance'
  | 'travel'
  | 'judge'
  | 'feedback'
  | 'pattern-extractor'
  | 'system-conscience';

export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';

export interface AgentRunResult {
  agentName: AgentName;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

// --- Opportunity Types ---
export type OpportunityCategory =
  | 'araba'
  | 'elektronik'
  | 'giyim'
  | 'ev-esyasi'
  | 'arbitraj'
  | 'finans'
  | 'diger';

export type OpportunityUrgency = 'low' | 'medium' | 'high' | 'critical';

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  category: OpportunityCategory;
  score: number; // 0-100
  expectedProfit: number; // TL
  expectedProfitPercent: number;
  timeframe: string;
  urgency: OpportunityUrgency;
  source: string;
  sourceUrl?: string;
  reasoning: string; // why this opportunity was suggested
  createdAt: string;
  expiresAt?: string;
}

// --- Scoring Types ---
export interface ScoringFactors {
  profitPotential: number; // 0-100, weight: 30%
  riskLevel: number; // 0-100 (inverted, lower=better), weight: 20%
  urgency: number; // 0-100, weight: 15%
  profileMatch: number; // 0-100, weight: 20%
  patternConfidence: number; // 0-100, weight: 15%
}

export interface ScoringResult {
  totalScore: number;
  factors: ScoringFactors;
  explanation: string;
}

// --- User Profile Types ---
export type RiskTolerance = 'low' | 'medium' | 'high';

export interface UserProfile {
  id: string;
  riskTolerance: RiskTolerance;
  preferredDomains: OpportunityCategory[];
  decisionSpeed: 'fast' | 'slow';
  profitHistory: {
    totalProfit: number;
    totalLoss: number;
    avgMargin: number;
    transactionCount: number;
  };
  activeWatchlists: string[];
  successfulPatterns: string[];
  blockedPatterns: string[];
  engagementScore: number; // 0-100
  updatedAt: string;
}

// --- Feedback Types ---
export type FeedbackOutcome = 'profit' | 'loss' | 'neutral' | 'skipped' | 'pending';

export interface RecommendationFeedback {
  id: string;
  opportunityId: string;
  outcome: FeedbackOutcome;
  actualProfit?: number;
  notes?: string;
  wantSimilar: boolean;
  createdAt: string;
}

// --- Strategy Types ---
export interface StrategyPattern {
  id: string;
  name: string;
  description: string;
  successCount: number;
  failCount: number;
  avgProfit: number;
  confidence: number; // 0-1
  status: 'active' | 'weakened' | 'on-hold';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StrategyWeight {
  patternId: string;
  weight: number; // -1 to 1
  reason: string;
  updatedAt: string;
}

// --- Chat Types ---
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentName?: AgentName;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// --- Notification Types ---
export type NotificationType = 'opportunity' | 'weekly-summary' | 'watchlist-alert' | 'profile-update';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sentAt: string;
}
