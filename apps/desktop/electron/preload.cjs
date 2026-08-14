const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cakalAPI', {
  // Analysis — open in browser.
  // Yalnız uygulamanın ürettiği artifactId kabul edilir; ham yol taşınmaz.
  openAnalysisArtifact: (artifactId) => ipcRenderer.invoke('analysis:open-artifact', artifactId),

  // AI Chat
  runAgent: (agentName, payload) =>
    ipcRenderer.invoke('agent:run', agentName, payload),

  // Cerrahi bakım — diff inceleme ve onaylı merge
  // Cerrahi oturum: bağlantı, bekleyen talepler, başlat/iptal.
  // Başlatma yetkisi yalnız kullanıcıdadır; ÇAKAL yalnız talep kaydeder.
  surgeryAuthStatus: () => ipcRenderer.invoke('surgery:auth-status'),
  surgeryLoginStart: () => ipcRenderer.invoke('surgery:login-start'),
  surgeryLoginCancel: () => ipcRenderer.invoke('surgery:login-cancel'),
  surgeryOpenDevicePage: () => ipcRenderer.invoke('surgery:open-device-page'),
  surgerySessionStatus: () => ipcRenderer.invoke('surgery:session-status'),
  surgeryListModels: () => ipcRenderer.invoke('surgery:list-models'),
  surgeryListRequests: () => ipcRenderer.invoke('surgery:list-requests'),
  surgeryStart: (payload) => ipcRenderer.invoke('surgery:start', payload),
  surgeryAbort: () => ipcRenderer.invoke('surgery:abort'),

  // Etkileşimli cerrahi sohbet — VS Code Copilot tarzı onay akışı.
  // Cerrahın her yazma/komut isteği `permission_request` olayı olarak
  // surgery-activity kanalından düşer; karar buradan geri gider.
  surgeryChatStart: (payload) => ipcRenderer.invoke('surgery:chat-start', payload),
  surgeryChatSend: (payload) => ipcRenderer.invoke('surgery:chat-send', payload),
  surgeryChatEnd: (payload) => ipcRenderer.invoke('surgery:chat-end', payload),
  surgeryChatApply: (payload) => ipcRenderer.invoke('surgery:chat-apply', payload),
  surgeryChatAbort: () => ipcRenderer.invoke('surgery:chat-abort'),
  surgeryRespondPermission: (payload) => ipcRenderer.invoke('surgery:permission-respond', payload),
  onSurgeryActivity: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('surgery-activity', handler);
    return () => ipcRenderer.removeListener('surgery-activity', handler);
  },

  surgeryListBranches: () => ipcRenderer.invoke('surgery:list-branches'),
  surgeryPreflight: (payload) => ipcRenderer.invoke('surgery:preflight', payload),
  surgeryDiff: (payload) => ipcRenderer.invoke('surgery:diff', payload),
  surgeryApproveMerge: (payload) => ipcRenderer.invoke('surgery:approve-merge', payload),

  // Database
  getProfile: () => ipcRenderer.invoke('db:get-profile'),
  updateProfile: (updates) => ipcRenderer.invoke('db:update-profile', updates),
  getOpportunities: (options) => ipcRenderer.invoke('db:get-opportunities', options),
  saveOpportunity: (opp) => ipcRenderer.invoke('db:save-opportunity', opp),
  getRecommendations: (options) => ipcRenderer.invoke('db:get-recommendations', options),
  saveFeedback: (feedback) => ipcRenderer.invoke('db:save-feedback', feedback),
  getDashboardStats: () => ipcRenderer.invoke('db:get-dashboard-stats'),
  getStrategyPatterns: () => ipcRenderer.invoke('db:get-strategy-patterns'),
  getCapabilities: (options) => ipcRenderer.invoke('db:get-capabilities', options),

  // Config
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  saveConfig: (settings) => ipcRenderer.invoke('config:save', settings),
  getAllConfig: () => ipcRenderer.invoke('config:get-all'),

  // Secret Broker — trusted renderer path; raw values are never sent through LLM tools
  storeSecret: (name, value) => ipcRenderer.invoke('secret:store', { name, value }),
  getSecretStatus: (name) => ipcRenderer.invoke('secret:status', name),
  listSecrets: () => ipcRenderer.invoke('secret:list'),
  listSecretRequests: () => ipcRenderer.invoke('secret:requests'),
  // Otonom entegrasyon: bekleyen secret isteği karşılandığında tetiklenir (ham değer içermez)
  onSecretRequestFulfilled: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('secret-request-fulfilled', handler);
    return () => {
      ipcRenderer.removeListener('secret-request-fulfilled', handler);
    };
  },

  // Telegram
  telegramTest: () => ipcRenderer.invoke('telegram:test'),
  telegramSend: (title, body, type) =>
    ipcRenderer.invoke('telegram:send', { title, body, type }),

  // Telegram Channel Reader (MTProto)
  telegramReaderConfigure: (apiId, apiHash) =>
    ipcRenderer.invoke('telegram-reader:configure', { apiId, apiHash }),
  telegramReaderSendCode: (phone) =>
    ipcRenderer.invoke('telegram-reader:send-code', { phone }),
  telegramReaderVerifyCode: (phone, code, phoneCodeHash) =>
    ipcRenderer.invoke('telegram-reader:verify-code', { phone, code, phoneCodeHash }),
  telegramReaderVerify2FA: (password) =>
    ipcRenderer.invoke('telegram-reader:verify-2fa', { password }),
  telegramReaderGetChannels: () =>
    ipcRenderer.invoke('telegram-reader:get-channels'),
  telegramReaderReadMessages: (channelId, limit) =>
    ipcRenderer.invoke('telegram-reader:read-messages', { channelId, limit }),
  telegramReaderSearch: (channelIds, keywords, limit) =>
    ipcRenderer.invoke('telegram-reader:search', { channelIds, keywords, limit }),
  telegramReaderGetSavedChannels: () =>
    ipcRenderer.invoke('telegram-reader:get-saved-channels'),
  telegramReaderSaveChannel: (channelId, title) =>
    ipcRenderer.invoke('telegram-reader:save-channel', { channelId, title }),
  telegramReaderRemoveChannel: (channelId) =>
    ipcRenderer.invoke('telegram-reader:remove-channel', { channelId }),
  telegramReaderStatus: () =>
    ipcRenderer.invoke('telegram-reader:status'),
  telegramReaderReset: () =>
    ipcRenderer.invoke('telegram-reader:reset'),

  // Scrape Sources
  getScrapeSources: () => ipcRenderer.invoke('db:get-scrape-sources'),
  updateScrapeSource: (sourceId, updates) =>
    ipcRenderer.invoke('db:update-scrape-source', sourceId, updates),

  // Watchlists
  getWatchlists: (options) =>
    ipcRenderer.invoke('db:get-watchlists', options),
  addWatchlist: (watchlist) =>
    ipcRenderer.invoke('db:add-watchlist', watchlist),
  removeWatchlist: (watchlistId) =>
    ipcRenderer.invoke('db:remove-watchlist', watchlistId),

  // Notification Log
  getNotificationLog: (options) =>
    ipcRenderer.invoke('db:get-notification-log', options),

  // User Index
  getUserIndex: (options) =>
    ipcRenderer.invoke('db:get-user-index', options),
  saveUserIndex: (entries) =>
    ipcRenderer.invoke('db:save-user-index', entries),

  // Profile Events
  getProfileEvents: (options) =>
    ipcRenderer.invoke('db:get-profile-events', options),

  // Weekly Report
  weeklyReport: () => ipcRenderer.invoke('profile:weekly-report'),

  // Pattern Extraction & Strategy
  extractPatterns: () => ipcRenderer.invoke('patterns:extract'),
  getDailySummary: () => ipcRenderer.invoke('patterns:daily-summary'),
  getTrendData: () => ipcRenderer.invoke('db:get-trend-data'),

  // Sprint 6: İleri Ajanlar — Doğrudan Çağrı
  runArbitrage: (payload) =>
    ipcRenderer.invoke('agent:run', 'arbitrage', payload),
  runStreetHunter: (payload) =>
    ipcRenderer.invoke('agent:run', 'street-hunter', payload),
  runFinance: (payload) =>
    ipcRenderer.invoke('agent:run', 'finance', payload),
  runTravel: (payload) =>
    ipcRenderer.invoke('agent:run', 'travel', payload),
  runJudge: (payload) =>
    ipcRenderer.invoke('agent:run', 'judge', payload),
  runCommerceVision: (payload) =>
    ipcRenderer.invoke('agent:run', 'commerce-vision', payload),
  runCommerceAutoPipeline: (payload) =>
    ipcRenderer.invoke('commerce:auto-pipeline', payload),

  // Sprint 7: System Conscience — Self-Awareness
  checkCapabilityGaps: () =>
    ipcRenderer.invoke('conscience:check-gaps'),
  generateProposal: (capabilityName) =>
    ipcRenderer.invoke('conscience:generate-proposal', capabilityName),
  getExpansionProposals: (options) =>
    ipcRenderer.invoke('conscience:get-proposals', options),
  respondToProposal: (proposalId, response, comment) =>
    ipcRenderer.invoke('conscience:respond-proposal', proposalId, response, comment),
  runSystemConscience: (payload) =>
    ipcRenderer.invoke('agent:run', 'system-conscience', payload),

  // Sprint 8: Evolution Engine — DB Authority
  getEvolutionDDLLog: (options) =>
    ipcRenderer.invoke('evolution:get-ddl-log', options),
  getEvolutionLog: (options) =>
    ipcRenderer.invoke('evolution:get-log', options),
  rollbackDDL: (ddlLogId) =>
    ipcRenderer.invoke('evolution:rollback-ddl', ddlLogId),
  getModelConfig: () =>
    ipcRenderer.invoke('evolution:get-model-config'),
  proposeCode: (payload) =>
    ipcRenderer.invoke('evolution:propose-code', payload),
  respondCode: (logId, response) =>
    ipcRenderer.invoke('evolution:respond-code', logId, response),

  // Sprint 9B: Self-Development — Dosya/Terminal/Arama
  selfDevReadFile: (filePath) =>
    ipcRenderer.invoke('selfdev:read-file', filePath),
  selfDevListFiles: (dirPath) =>
    ipcRenderer.invoke('selfdev:list-files', dirPath),
  selfDevRunCommand: (command, timeoutMs) =>
    ipcRenderer.invoke('selfdev:run-command', command, timeoutMs),
  getAgentRuns: (options) =>
    ipcRenderer.invoke('selfdev:get-agent-runs', options),

  // Chat Messages (conversation_logs)
  uploadChatImage: (dataUrl) => ipcRenderer.invoke('db:upload-chat-image', dataUrl),
  saveMessage: (msg) => ipcRenderer.invoke('db:save-message', msg),
  getMessages: (options) => ipcRenderer.invoke('db:get-messages', options),

  // Sesli Asistan — STT/TTS (yalnızca overlay açıkken çağrılır)
  voiceTranscribe: (audioBase64, mimeType) =>
    ipcRenderer.invoke('voice:transcribe', { audioBase64, mimeType }),
  voiceTts: (text) => ipcRenderer.invoke('voice:tts', { text }),

  // Notifications (realtime)
  onNotification: (callback) => {
    ipcRenderer.on('notification', (_event, data) => callback(data));
  },

  // Agent Activity Monitor (realtime)
  onAgentActivity: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('agent-activity', handler);
    // Return cleanup function so the renderer can unsubscribe
    return () => {
      ipcRenderer.removeListener('agent-activity', handler);
    };
  },
});
