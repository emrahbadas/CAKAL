/// <reference types="vite/client" />

interface DbResult<T = unknown> {
  status: 'ok' | 'error';
  data?: T;
  error?: string;
}

interface TelegramReaderSendCodeResult extends DbResult {
  phoneCodeHash?: string;
}

interface TelegramReaderVerifyResult extends DbResult {
  status: 'ok' | 'error' | 'need_2fa';
  message?: string;
}

interface CakalAPI {
  // AI Chat
  runAgent: (agentName: string, payload: unknown) => Promise<unknown>;

  // Database
  getProfile: () => Promise<DbResult>;
  updateProfile: (updates: Record<string, unknown>) => Promise<DbResult>;
  getOpportunities: (options?: Record<string, unknown>) => Promise<DbResult>;
  saveOpportunity: (opp: Record<string, unknown>) => Promise<DbResult>;
  getRecommendations: (options?: Record<string, unknown>) => Promise<DbResult>;
  saveFeedback: (feedback: Record<string, unknown>) => Promise<DbResult>;
  getDashboardStats: () => Promise<DbResult>;
  getStrategyPatterns: () => Promise<DbResult>;
  getCapabilities: (options?: Record<string, unknown>) => Promise<DbResult>;

  // Config
  getConfig: (key: string) => Promise<string | null>;
  saveConfig: (settings: Record<string, string>) => Promise<DbResult>;
  getAllConfig: () => Promise<DbResult>;
  storeSecret: (name: string, value: string) => Promise<DbResult>;
  getSecretStatus: (name: string) => Promise<DbResult>;
  listSecrets: () => Promise<DbResult>;
  listSecretRequests: () => Promise<DbResult>;
  onSecretRequestFulfilled: (
    callback: (data: { name: string; ref: string; capability_name: string; test_input: Record<string, unknown> | null }) => void
  ) => (() => void) | void;

  // Telegram
  telegramTest: () => Promise<DbResult & { message?: string }>;
  telegramSend: (title: string, body: string, type?: string) => Promise<DbResult>;
  telegramReaderConfigure: (apiId: string, apiHash: string) => Promise<DbResult>;
  telegramReaderSendCode: (phone: string) => Promise<TelegramReaderSendCodeResult>;
  telegramReaderVerifyCode: (phone: string, code: string, phoneCodeHash: string) => Promise<TelegramReaderVerifyResult>;
  telegramReaderVerify2FA: (password: string) => Promise<TelegramReaderVerifyResult>;
  telegramReaderGetChannels: () => Promise<DbResult>;
  telegramReaderReadMessages: (channelId: string, limit?: number) => Promise<DbResult>;
  telegramReaderSearch: (channelIds: string[], keywords: string[], limit?: number) => Promise<DbResult>;
  telegramReaderGetSavedChannels: () => Promise<DbResult>;
  telegramReaderSaveChannel: (channelId: string, title?: string) => Promise<DbResult>;
  telegramReaderRemoveChannel: (channelId: string) => Promise<DbResult>;
  telegramReaderStatus: () => Promise<DbResult>;
  telegramReaderReset: () => Promise<DbResult>;

  // Scrape Sources
  getScrapeSources: () => Promise<DbResult>;
  updateScrapeSource: (sourceId: string, updates: Record<string, unknown>) => Promise<DbResult>;

  // Notification Log
  getNotificationLog: (options?: { type?: string; limit?: number }) => Promise<DbResult>;

  // User Index
  getUserIndex: (options?: { entry_type?: string; limit?: number }) => Promise<DbResult>;
  saveUserIndex: (entries: Record<string, unknown> | Record<string, unknown>[]) => Promise<DbResult>;

  // Profile Events
  getProfileEvents: (options?: { event_type?: string; limit?: number }) => Promise<DbResult>;

  // Weekly Report
  weeklyReport: () => Promise<DbResult>;

  // Pattern Extraction & Strategy
  extractPatterns: () => Promise<DbResult>;
  getDailySummary: () => Promise<DbResult>;
  getTrendData: () => Promise<DbResult>;

  // Sprint 6: İleri Ajanlar
  runArbitrage: (payload: Record<string, unknown>) => Promise<DbResult>;
  runStreetHunter: (payload: Record<string, unknown>) => Promise<DbResult>;
  runFinance: (payload: Record<string, unknown>) => Promise<DbResult>;
  runTravel: (payload: Record<string, unknown>) => Promise<DbResult>;
  runJudge: (payload: Record<string, unknown>) => Promise<DbResult>;
  runCommerceVision: (payload: Record<string, unknown>) => Promise<DbResult>;
  runCommerceAutoPipeline: (payload: Record<string, unknown>) => Promise<DbResult>;

  // Sprint 7: System Conscience — Self-Awareness
  checkCapabilityGaps: () => Promise<DbResult>;
  generateProposal: (capabilityName: string) => Promise<DbResult>;
  getExpansionProposals: (options?: { status?: string; limit?: number }) => Promise<DbResult>;
  respondToProposal: (proposalId: string, response: 'accepted' | 'rejected', comment?: string) => Promise<DbResult>;
  runSystemConscience: (payload: Record<string, unknown>) => Promise<DbResult>;

  // Sprint 8: Evolution Engine — DB Authority
  getEvolutionDDLLog: (options?: { status?: string; ddl_type?: string; limit?: number }) => Promise<DbResult>;
  getEvolutionLog: (options?: { status?: string; evolution_type?: string; limit?: number }) => Promise<DbResult>;
  rollbackDDL: (ddlLogId: string) => Promise<DbResult>;
  getModelConfig: () => Promise<DbResult>;
  proposeCode: (payload: { evolutionType: string; title: string; description?: string; targetPath?: string }) => Promise<DbResult>;
  respondCode: (logId: string, response: 'approved' | 'rejected') => Promise<DbResult>;
  getAgentRuns?: (options?: { agent_name?: string; status?: string; limit?: number }) => Promise<DbResult>;

  // Chat Messages
  uploadChatImage: (dataUrl: string) => Promise<{ status: string; url?: string; error?: string }>;
  saveMessage: (msg: { id: string; role: string; content: string; timestamp?: number }) => Promise<DbResult>;
  getMessages: (options?: { limit?: number }) => Promise<DbResult>;

  // Sesli Asistan — STT/TTS
  voiceTranscribe: (audioBase64: string, mimeType?: string) => Promise<{ success: boolean; text?: string; error?: string; unreliable?: boolean; hallucination?: boolean }>;
  voiceTts: (text: string) => Promise<{ success: boolean; audioBase64?: string; audioChunks?: string[]; mimeType?: string; error?: string }>;

  // Notifications (realtime)
  onNotification: (callback: (data: unknown) => void) => void;

  // Agent Activity Monitor (realtime)
  onAgentActivity: (callback: (event: AgentActivityEvent) => void) => (() => void) | void;
}

interface AgentActivityEvent {
  type:
    | 'intent_received'
    | 'profile_loaded'
    | 'agent_start'
    | 'agent_thinking'
    | 'decision_gate'
    | 'db_fetch'
    | 'db_fetch_done'
    | 'tool_calls_detected'
    | 'tool_calling'
    | 'tool_call'
    | 'tool_calls'
    | 'tool_result'
    | 'llm_start'
    | 'llm_continue'
    | 'response_ready'
    | 'self_evaluation'
    | 'error';
  agent?: string;
  message?: string;
  detail?: string;
  tool?: string;
  tools?: string[];
  args?: Record<string, unknown>;
  resultPreview?: string;
  count?: number;
  iteration?: number;
  contentLength?: number;
  hasProfile?: boolean;
  indexCount?: number;
  patternCount?: number;
  timestamp: number;
}

declare global {
  interface Window {
    cakalAPI: CakalAPI;
  }
}

export {};
