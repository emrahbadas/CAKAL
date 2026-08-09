import { describe, it, expect } from 'vitest';

import {
  CopilotSurgeon,
  extractReplyText,
} from '../apps/desktop/electron/surgery/copilot-surgeon.cjs';

// Cerrahın cevabı neden kaybolmuştu?
//
// `session.sendAndWait()` düz metin DEĞİL bir olay döndürüyor:
//   AssistantMessageEvent { type: "assistant.message", data: { content: "..." } }
// Kod `result.text` okuyordu — SDK'da öyle bir alan yok. Sonuç: cevap her
// zaman null, arayüzde "(cevap metni gelmedi)". Çökme olmadığı için hata
// sessizdi; ancak canlı denemede görüldü.
//
// Bu dosya o şekli sabitler. SDK sürümü alanı taşırsa test kırılır ve
// kullanıcı boş balon görmeden önce biz haberdar oluruz.

/** SDK'nın gerçek cevap şekli (session-events.d.ts'ten birebir). */
function assistantMessageEvent(content) {
  return {
    type: 'assistant.message',
    id: 'evt-1',
    parentId: null,
    timestamp: new Date().toISOString(),
    data: { content, messageId: 'msg-1', model: 'claude-sonnet-5' },
  };
}

function surgeonWithReply(result) {
  const surgeon = new CopilotSurgeon({
    clientFactory: () => ({
      start: async () => {},
      getAuthStatus: async () => ({ isAuthenticated: true }),
      createSession: async () => ({
        on: () => () => {},
        sendAndWait: async () => result,
        abort: async () => {},
        disconnect: async () => {},
      }),
      stop: async () => {},
    }),
  });
  return surgeon;
}

describe('asistan cevabı çıkarımı', () => {
  it('SDK olay şeklinden metni okur (data.content)', () => {
    expect(extractReplyText(assistantMessageEvent('iş bitti'))).toBe('iş bitti');
  });

  it('cevapsız turda null döner', () => {
    expect(extractReplyText(undefined)).toBeNull();
    expect(extractReplyText(null)).toBeNull();
  });

  it('boş/whitespace içerik null sayılır', () => {
    expect(extractReplyText(assistantMessageEvent(''))).toBeNull();
    expect(extractReplyText(assistantMessageEvent('   '))).toBeNull();
  });

  it('savunma yolları: düz string ve content/text alanları', () => {
    expect(extractReplyText('düz metin')).toBe('düz metin');
    expect(extractReplyText({ content: 'içerik' })).toBe('içerik');
    expect(extractReplyText({ text: 'eski alan' })).toBe('eski alan');
  });

  it('ARTIK `text` alanına düşmez — data.content önceliklidir', () => {
    const mixed = { ...assistantMessageEvent('doğru cevap'), text: 'yanlış alan' };
    expect(extractReplyText(mixed)).toBe('doğru cevap');
  });
});

describe('sohbet turu — cevap uçtan uca taşınır', () => {
  it('sendMessage gerçek olay şeklinden cevabı döndürür', async () => {
    const surgeon = surgeonWithReply(assistantMessageEvent('README güncellendi.'));
    await surgeon.connect();
    await surgeon.startInteractive({ worktreePath: '/tmp/cakal-wt' });

    const turn = await surgeon.sendMessage('README güncelle');

    expect(turn.reply).toBe('README güncellendi.');
  });

  it('cevap metnindeki token maskelenir', async () => {
    const surgeon = surgeonWithReply(
      assistantMessageEvent('Anahtar: ghp_abcdefghijklmnopqrstuvwxyz0123 kullandım.'),
    );
    await surgeon.connect();
    await surgeon.startInteractive({ worktreePath: '/tmp/cakal-wt' });

    const turn = await surgeon.sendMessage('bir şey yap');

    expect(turn.reply).not.toMatch(/ghp_abcdefghij/);
    expect(turn.reply).toMatch(/REDACTED/);
  });

  it('tek atımlı runSurgery de aynı şekli okur', async () => {
    const surgeon = surgeonWithReply(assistantMessageEvent('cerrahi tamam'));
    await surgeon.connect();

    const result = await surgeon.runSurgery({
      changeRequest: { changeRequestId: 'CR-test' },
      worktreePath: '/tmp/cakal-wt',
      prompt: 'görev',
    });

    expect(result.reply).toBe('cerrahi tamam');
    expect(result.status).toBe('COMPLETED');
  });

  it('boş oturuma mesaj gönderilemez', async () => {
    const surgeon = surgeonWithReply(assistantMessageEvent('x'));
    await surgeon.connect();
    await expect(surgeon.sendMessage('merhaba')).rejects.toThrow(/oturum yok/i);
  });
});
