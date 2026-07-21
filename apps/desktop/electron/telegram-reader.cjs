// ═══════════════════════════════════════════════
// Telegram Channel Reader — GramJS MTProto Client
// Kullanıcının katıldığı kanallardan mesaj okur
// ═══════════════════════════════════════════════

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const path = require('path');
const fs = require('fs');

class TelegramReader {
  constructor(configPath) {
    this.configPath = configPath;
    this.client = null;
    this.apiId = null;
    this.apiHash = null;
    this.session = null;
    this.connected = false;
  }

  _normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _toIsoDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      // GramJS date alanı çoğunlukla unix seconds gelir.
      const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async _resolveChannelEntity(channelRef) {
    await this.connect();

    const raw = String(channelRef || '').trim();
    if (!raw) throw new Error('Kanal referansı boş');

    const directCandidates = [];
    if (/^-?\d+$/.test(raw)) {
      try {
        directCandidates.push(BigInt(raw));
      } catch {
        directCandidates.push(raw);
      }
    } else {
      directCandidates.push(raw);
      if (!raw.startsWith('@')) directCandidates.push(`@${raw}`);
    }

    for (const candidate of directCandidates) {
      try {
        const entity = await this.client.getEntity(candidate);
        return {
          entity,
          channelId: entity?.id?.toString?.() || raw,
          channelTitle: entity?.title || entity?.username || raw,
        };
      } catch {
        // Bir sonraki aday ile devam et.
      }
    }

    const channels = await this.getJoinedChannels();
    const normalizedRaw = this._normalizeText(raw.replace(/^@/, ''));

    const exactMatch = channels.find((ch) => {
      const id = this._normalizeText(ch.id);
      const title = this._normalizeText(ch.title);
      const username = this._normalizeText((ch.username || '').replace(/^@/, ''));
      return normalizedRaw === id || normalizedRaw === title || normalizedRaw === username;
    });

    const fuzzyMatch = exactMatch || channels.find((ch) => {
      const title = this._normalizeText(ch.title);
      const username = this._normalizeText((ch.username || '').replace(/^@/, ''));
      return (title && (title.includes(normalizedRaw) || normalizedRaw.includes(title)))
        || (username && (username.includes(normalizedRaw) || normalizedRaw.includes(username)));
    });

    if (fuzzyMatch) {
      const fallbackCandidates = [];
      if (fuzzyMatch.username) fallbackCandidates.push(`@${String(fuzzyMatch.username).replace(/^@/, '')}`);
      if (fuzzyMatch.id && /^-?\d+$/.test(String(fuzzyMatch.id))) {
        try {
          fallbackCandidates.push(BigInt(String(fuzzyMatch.id)));
        } catch {
          fallbackCandidates.push(String(fuzzyMatch.id));
        }
      }
      fallbackCandidates.push(fuzzyMatch.title);

      for (const candidate of fallbackCandidates) {
        try {
          const entity = await this.client.getEntity(candidate);
          return {
            entity,
            channelId: fuzzyMatch.id || entity?.id?.toString?.() || raw,
            channelTitle: fuzzyMatch.title || entity?.title || entity?.username || raw,
          };
        } catch {
          // Bir sonraki aday ile devam et.
        }
      }
    }

    const hint = channels
      .slice(0, 5)
      .map(ch => ch.username ? `${ch.title} (@${ch.username.replace(/^@/, '')})` : ch.title)
      .join(', ');

    throw new Error(`Kanal bulunamadı: ${raw}. İpucu: list_channels çıktısındaki id veya @username kullan. Örnekler: ${hint}`);
  }

  // ─── Config load/save ───

  _loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return {};
  }

  _saveConfig(updates) {
    const config = this._loadConfig();
    Object.assign(config, updates);
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // ─── Init & Auth ───

  configure(apiId, apiHash) {
    this.apiId = Number(apiId);
    this.apiHash = String(apiHash);
    const config = this._loadConfig();
    this.session = new StringSession(config.TELEGRAM_SESSION || '');
  }

  isConfigured() {
    return !!(this.apiId && this.apiHash);
  }

  isAuthenticated() {
    const config = this._loadConfig();
    return !!(config.TELEGRAM_SESSION && config.TELEGRAM_SESSION.length > 10);
  }

  async connect() {
    if (!this.isConfigured()) throw new Error('API ID ve API Hash ayarlanmamış');
    if (this.connected && this.client) return;

    const config = this._loadConfig();
    this.session = new StringSession(config.TELEGRAM_SESSION || '');

    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
      connectionRetries: 3,
      deviceModel: 'ÇAKAL Fırsat Motoru',
      appVersion: '1.0',
      systemVersion: 'Windows',
      useWSS: true,
      receiveUpdates: false,
    });

    await this.client.connect();
    this.connected = true;
    console.log('[TelegramReader] Connected');
  }

  async disconnect() {
    if (this.client && this.connected) {
      await this.client.disconnect();
      this.connected = false;
      console.log('[TelegramReader] Disconnected');
    }
  }

  // Step 1: Send code to phone
  async sendCode(phone) {
    await this.connect();
    console.log('[TelegramReader] Sending code to:', phone);
    const result = await this.client.sendCode(
      { apiId: this.apiId, apiHash: this.apiHash },
      String(phone)
    );
    this._phoneCodeHash = result.phoneCodeHash;
    this._phone = phone;
    console.log('[TelegramReader] Code sent — hashLen:', result.phoneCodeHash?.length);
    return { phoneCodeHash: result.phoneCodeHash };
  }

  // Step 2: Verify code
  async verifyCode(phone, code, phoneCodeHash) {
    if (!this.client) throw new Error('Client bağlı değil');
    console.log('[TelegramReader] verifyCode called — phone:', phone, 'codeLen:', String(code).length, 'hashLen:', (phoneCodeHash || this._phoneCodeHash || '').length);

    try {
      const result = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: String(phone),
          phoneCodeHash: String(phoneCodeHash || this._phoneCodeHash),
          phoneCode: String(code),
        })
      );
      console.log('[TelegramReader] SignIn result:', result?.className);
    } catch (err) {
      console.log('[TelegramReader] SignIn error:', err.errorMessage || err.message);
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return { status: 'need_2fa', message: '2FA şifre gerekli' };
      }
      throw err;
    }

    // Save session
    const sessionStr = this.client.session.save();
    this._saveConfig({ TELEGRAM_SESSION: sessionStr });
    console.log('[TelegramReader] Authenticated & session saved');
    return { status: 'ok', message: 'Giriş başarılı!' };
  }

  // Step 2b: 2FA password
  async verify2FA(password) {
    if (!this.client) throw new Error('Client bağlı değil');

    const passwordInfo = await this.client.invoke(new Api.account.GetPassword());
    const result = await this.client.invoke(
      new Api.auth.CheckPassword({
        password: await this.client._computeCheck(passwordInfo, password),
      })
    );

    const sessionStr = this.client.session.save();
    this._saveConfig({ TELEGRAM_SESSION: sessionStr });
    console.log('[TelegramReader] 2FA verified & session saved');
    return { status: 'ok', message: '2FA doğrulama başarılı!' };
  }

  // ─── Channel Operations ───

  // Kullanıcının katıldığı kanalları listele
  async getJoinedChannels() {
    await this.connect();

    const dialogs = await this.client.getDialogs({ limit: 200 });
    const channels = dialogs
      .filter(d => d.isChannel || d.isGroup)
      .map(d => ({
        id: d.id?.toString(),
        title: d.title || d.name || 'Adsız',
        username: d.entity?.username || null,
        participantsCount: d.entity?.participantsCount || 0,
        isChannel: !!d.isChannel,
        isGroup: !!d.isGroup,
      }));

    return channels;
  }

  // Belirli bir kanalın son mesajlarını oku
  async readChannelMessages(channelId, limit = 20) {
    await this.connect();

    const resolved = await this._resolveChannelEntity(channelId);
    const entity = resolved.entity;

    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const messages = await this.client.getMessages(entity, { limit: safeLimit });

    return messages
      .filter(m => m.message) // Sadece metin mesajları
      .map(m => ({
        id: m.id,
        date: this._toIsoDate(m.date),
        text: m.message,
        views: m.views || 0,
        forwards: m.forwards || 0,
        sender: m.fromId?.userId?.toString() || 'channel',
        channel: resolved.channelTitle,
        channelId: resolved.channelId,
      }));
  }

  // Birden fazla kanaldan keyword araması
  async searchChannels(channelIds, keywords, limit = 10) {
    await this.connect();

    const cleanKeywords = (Array.isArray(keywords) ? keywords : [])
      .map(k => String(k || '').trim().toLowerCase())
      .filter(Boolean);
    if (cleanKeywords.length === 0) {
      throw new Error('Geçerli keyword bulunamadı');
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    const results = [];

    for (const chId of channelIds) {
      try {
        const resolved = await this._resolveChannelEntity(chId);
        const entity = resolved.entity;
        const channelTitle = resolved.channelTitle || entity.title || entity.username || chId;

        // Get recent messages
        const messages = await this.client.getMessages(entity, { limit: 50 });

        const matched = messages
          .filter(m => {
            if (!m.message) return false;
            const txt = m.message.toLowerCase();
            return cleanKeywords.some(kw => txt.includes(kw));
          })
          .slice(0, safeLimit)
          .map(m => ({
            channel: channelTitle,
            channelId: resolved.channelId || chId,
            id: m.id,
            date: this._toIsoDate(m.date),
            text: m.message,
            views: m.views || 0,
          }));

        results.push(...matched);
      } catch (err) {
        console.warn(`[TelegramReader] ${chId} okunamadı:`, err.message);
        results.push({
          channel: chId,
          channelId: chId,
          id: 0,
          date: null,
          text: `[HATA: ${err.message}]`,
          views: 0,
        });
      }
    }

    // Tarihe göre sırala (en yeni en üstte)
    return results
      .filter(r => r.id !== 0)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, safeLimit * channelIds.length);
  }

  // Kaydedilmiş kanal listesini yönet
  getSavedChannels() {
    const config = this._loadConfig();
    return config.TELEGRAM_CHANNELS || [];
  }

  saveChannels(channels) {
    this._saveConfig({ TELEGRAM_CHANNELS: channels });
  }

  addChannel(channelId, title) {
    const channels = this.getSavedChannels();
    if (!channels.find(c => c.id === channelId)) {
      channels.push({ id: channelId, title: title || channelId, addedAt: new Date().toISOString() });
      this.saveChannels(channels);
    }
    return channels;
  }

  removeChannel(channelId) {
    let channels = this.getSavedChannels();
    channels = channels.filter(c => c.id !== channelId);
    this.saveChannels(channels);
    return channels;
  }
}

module.exports = { TelegramReader };
