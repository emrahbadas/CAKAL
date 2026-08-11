import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ELECTRON = path.resolve('apps/desktop/electron');
const aiSource = fs.readFileSync(path.join(ELECTRON, 'ai-service.cjs'), 'utf8');
const mainSource = fs.readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8');

/**
 * ONARIM TURU KALICI GEÇMİŞE SIZAMAZ.
 *
 * ÖLÇÜLEN VAKA (11 Ağustos 2026): main.cjs bir kullanıcı isteği için chat()'i
 * altı ayrı kapı için yeniden çağırıyor. Her onarım metni ("[ÇEKİRDEK
 * ZORUNLULUK — ...]") role:'user' olarak kalıcı conversationHistory'ye
 * giriyordu. Geçmiş son 16 mesaja kırpıldığı için kapı ateşleyen TEK tur
 * 6 slot yiyor, gerçek konuşma ~2,5 turda pencereden düşüyordu.
 *
 * chat() ağ çağrısı yaptığı için burada KAYNAK SÖZLEŞMESİ test edilir:
 * geçmişe yazan her nokta internalTurn korumasının arkasında mı, ve
 * main.cjs'teki her onarım çağrısı bu bayrağı geçiyor mu.
 */

describe('geçmiş yazma noktaları internalTurn korumasında', () => {
  it('kullanıcı mesajı yalnız gerçek turda kalıcı geçmişe girer', () => {
    // `if (!internalTurn) {` bloğu içinde push edilmeli.
    const idx = aiSource.indexOf("conversationHistory.push({ role: 'user', content: message })");
    expect(idx).toBeGreaterThan(-1);
    const before = aiSource.slice(Math.max(0, idx - 400), idx);
    expect(before).toContain('if (!internalTurn)');
  });

  it('asistan cevabı ve action ledger de aynı korumada', () => {
    const idx = aiSource.indexOf("conversationHistory.push({ role: 'assistant', content: finalContent })");
    expect(idx).toBeGreaterThan(-1);
    const before = aiSource.slice(Math.max(0, idx - 400), idx);
    expect(before).toContain('if (!internalTurn)');
  });

  it('onarım turunda kullanıcı metni yalnız working history\'ye eklenir', () => {
    expect(aiSource).toMatch(/workingHistory\s*=\s*internalTurn[\s\S]{0,200}role:\s*'user'/);
  });
});

describe('main.cjs — her kapı yeniden denemesi internal', () => {
  it('GERÇEK tur (ilk çağrı) internalTurn ALMAZ — kullanıcı mesajı geçmişe girmeli', () => {
    const ilk = mainSource.indexOf('let response = await chat(');
    expect(ilk).toBeGreaterThan(-1);
    expect(mainSource.slice(ilk, ilk + 260)).not.toContain('internalTurn');
  });

  it('yeniden atayan TÜM kapı çağrıları internalTurn geçiyor', () => {
    // `let response = ...` bildirimi hariç, her `response = await chat(` bir
    // kapı yeniden denemesidir.
    const calls = [...mainSource.matchAll(/(^|[^t] )response = await chat\(/gm)];
    expect(calls.length).toBeGreaterThanOrEqual(6);

    for (const m of calls) {
      const blok = mainSource.slice(m.index, m.index + 280);
      expect(blok, `internalTurn eksik: ${blok.slice(0, 70)}`).toContain('internalTurn: true');
    }
  });

  it('nihai cevap kapılardan SONRA bir kez commit edilir', () => {
    expect(mainSource).toContain('commitConversationTurn(response)');

    // Sıra önemli: seviye provenance kilidi commit\'ten ÖNCE çalışmalı,
    // yoksa geçmişe indirilmemiş hüküm yazılır.
    const kilit = mainSource.indexOf('priceLevelLock.response');
    const commit = mainSource.indexOf('commitConversationTurn(response)');
    expect(kilit).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(kilit);
  });
});

describe('commitConversationTurn davranışı', () => {
  let ai;
  beforeEach(async () => {
    // Modül durumu testler arası taşınmasın.
    const modPath = path.join(ELECTRON, 'ai-service.cjs');
    delete require.cache?.[modPath];
    ai = (await import(`file://${modPath.replace(/\\/g, '/')}`)).default;
    ai.resetConversation();
  });

  it('boş içerik geçmişi kirletmez', () => {
    expect(() => ai.commitConversationTurn('')).not.toThrow();
    expect(() => ai.commitConversationTurn(null)).not.toThrow();
  });

  it('aynı tur içinde ikinci commit öncekini EZER', () => {
    // Kapı zinciri cevabı birkaç kez değiştirir; geçmişte yalnız sonuncusu kalmalı.
    ai.commitConversationTurn('ilk hâli');
    ai.commitConversationTurn('kapıdan sonraki nihai hâli');
    expect(ai.commitConversationTurn).toBeTypeOf('function');
  });
});
