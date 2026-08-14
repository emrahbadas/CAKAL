import { describe, it, expect } from 'vitest';

import cleanup from '../apps/desktop/scripts/cleanup-dev-ports.cjs';

const { parseListeningPids, PORTS } = cleanup;

/**
 * CANLI HATA REGRESYONU — 14 Ağustos 2026
 *
 * `npm run dev` "Port 5173 is already in use" ile düştü, ama ondan hemen önce
 * çalışan temizleyici "No conflicting ports found" dedi. Yani tam bu durum
 * için var olan script sessizce başarısız oldu.
 *
 * SEBEP: script `netstat -ano -p tcp` çalıştırıyordu. Windows'ta `-p tcp`
 * YALNIZ IPv4'ü listeler; IPv6 için protokol adı ayrıdır (`tcpv6`). Vite
 * `[::1]:5173` yani IPv6 loopback'e bağlanır → süreç çıktıda hiç görünmez.
 * Deneyle doğrulandı: aynı anda `-p tcp` hiçbir şey bulmadı, filtresiz
 * netstat `TCP [::1]:5173 ... LISTENING 13984` satırını buldu.
 *
 * Ayrıştırma kodu zaten doğruydu — BESLENEN VERİ eksikti. Bu yüzden test
 * ayrıştırıcıyı gerçek netstat çıktısıyla sınar.
 */

// Gerçek `netstat -ano` çıktısından alınmış satırlar (biçim birebir korundu).
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1284
  TCP    127.0.0.1:5175         0.0.0.0:0              LISTENING       4242
  TCP    [::]:445               [::]:0                 LISTENING       4
  TCP    [::1]:5173             [::]:0                 LISTENING       13984
  TCP    [::1]:5173             [::1]:56626            ESTABLISHED     13984
  TCP    [::1]:56626            [::1]:5173             ESTABLISHED     17204
  UDP    0.0.0.0:5353           *:*                                    5173
  UDP    [::]:5174              *:*                                    9999
`;

describe('netstat ayrıştırması', () => {
  it('REGRESYON — IPv6 loopback dinleyicisi bulunuyor', () => {
    // Asıl hata buydu: [::1]:5173 görülmüyordu.
    expect(parseListeningPids(NETSTAT, [5173])).toContain('13984');
  });

  it('IPv4 dinleyicisi de bulunuyor (kapsam daralmadı)', () => {
    expect(parseListeningPids(NETSTAT, [5175])).toEqual(['4242']);
  });

  it('ESTABLISHED bağlantı LISTENING sanılmıyor', () => {
    // 17204 aynı portu KULLANIYOR ama dinlemiyor; onu öldürmek yanlış olurdu.
    expect(parseListeningPids(NETSTAT, [5173])).not.toContain('17204');
  });

  it('UDP satırındaki PID sütunu port sanılmıyor', () => {
    // UDP satırında Durum sütunu YOKTUR; sütun sayısı 4'tür. Gevşek bir
    // ayrıştırıcı "5173"ü PID sütununda görüp karıştırabilir.
    const pids = parseListeningPids(NETSTAT, [5353]);
    expect(pids).toEqual([]);
  });

  it('UDP dinleyicisi hiç sayılmıyor', () => {
    expect(parseListeningPids(NETSTAT, [5174])).not.toContain('9999');
  });

  it('ilgisiz portlara dokunulmuyor', () => {
    expect(parseListeningPids(NETSTAT, [5173, 5174, 5175]).sort()).toEqual(['13984', '4242']);
    expect(parseListeningPids(NETSTAT, [8080])).toEqual([]);
  });

  it('aynı port birden çok arayüzde dinleniyorsa PID tekilleşir', () => {
    const dual = `
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       777
  TCP    [::]:5173              [::]:0                 LISTENING       777
`;
    expect(parseListeningPids(dual, [5173])).toEqual(['777']);
  });

  it('boş/bozuk girdide çökmüyor', () => {
    expect(parseListeningPids('', [5173])).toEqual([]);
    expect(parseListeningPids(null, [5173])).toEqual([]);
    expect(parseListeningPids('saçma satır\n\n  TCP  eksik', [5173])).toEqual([]);
  });

  it('izlenen port listesi Vite aralığını kapsıyor', () => {
    expect(PORTS).toContain(5173);
  });
});
