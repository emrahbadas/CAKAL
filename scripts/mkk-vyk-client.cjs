'use strict';

/**
 * MKK KAP VYK API icin minimal CommonJS istemci (sync worker tarafi).
 *
 * TypeScript adapter'i (packages/sources/mkk-vyk) Electron/CJS scriptlerinden
 * require edilemedigi icin bu ince istemci ayni auth oncelik kuralini uygular:
 * apigwdev gateway canli testte yalniz Basic (API_KEY:API_SECRET) kabul etti;
 * portal token'i yalnizca key/secret yoksa Bearer olarak denenir.
 *
 * Rate limit: ucretsiz plan 6 cagri/dk; varsayilan 12 sn aralik (5 cagri/dk)
 * istemci icinde zorunludur ve tests disinda kapatilmamalidir.
 */

const MKK_VYK_DEFAULT_BASE_URL = 'https://apigwdev.mkk.com.tr/api/vyk';

function createMkkVykClient(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = String(env.MKK_VYK_BASE_URL || MKK_VYK_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiKey = env.MKK_VYK_API_KEY;
  const apiSecret = env.MKK_VYK_API_SECRET;
  const apiToken = env.MKK_VYK_API_TOKEN;

  if (!(apiKey && apiSecret) && !apiToken) return null;

  const minIntervalMs = options.minIntervalMs ?? (env.MKK_VYK_MIN_INTERVAL_MS ? Number(env.MKK_VYK_MIN_INTERVAL_MS) : 12000);
  const authorization = apiKey && apiSecret
    ? `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
    : `Bearer ${apiToken}`;

  let lastRequestAt = 0;

  async function waitForRateLimit() {
    if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0 || lastRequestAt === 0) return;
    const waitMs = minIntervalMs - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  async function getJson(pathWithQuery) {
    await waitForRateLimit();
    const response = await fetchImpl(`${baseUrl}${pathWithQuery}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json, */*;q=0.8',
        Authorization: authorization,
        'User-Agent': 'CakalKapSyncVyk/1.0',
      },
    });
    lastRequestAt = Date.now();
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`MKK VYK ${pathWithQuery} basarisiz: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`MKK VYK ${pathWithQuery} JSON degil: ${text.slice(0, 120)}`);
    }
  }

  return {
    authMode: apiKey && apiSecret ? 'BASIC' : 'BEARER',
    async fetchLastDisclosureIndex() {
      const body = await getJson('/lastDisclosureIndex');
      const value = body && typeof body === 'object' ? body.lastDisclosureIndex : body;
      if (value === undefined || value === null || value === '') {
        throw new Error('MKK VYK lastDisclosureIndex bos dondu.');
      }
      return String(value);
    },
    async fetchDisclosuresSince(disclosureIndex) {
      const body = await getJson(`/disclosures?disclosureIndex=${encodeURIComponent(String(disclosureIndex))}`);
      return Array.isArray(body) ? body : [];
    },
    async fetchMembers() {
      const body = await getJson('/members');
      return Array.isArray(body) ? body : [];
    },
    /**
     * FR (finansal rapor) bildirim detayi. Canli dogrulama (2026-07-19):
     * yalniz FR bildirimlerinde 200 doner (ODA/DG icin ER005 "not found");
     * yanit senderExchCodes, subject ve rapor icerigini tasiyan JSON'dur.
     * DIKKAT: apigwdev id uzayi KAP web bildirim id uzayindan FARKLIDIR;
     * KAP web'den alinan disclosure id ile cagirilamaz.
     */
    async fetchDisclosureDetail(disclosureIndex, fileType = 'html') {
      return getJson(`/disclosureDetail/${encodeURIComponent(String(disclosureIndex))}?fileType=${encodeURIComponent(fileType)}`);
    },
  };
}

/**
 * VYK /members satirlarindan companyId -> hisse kodlari eslemesi kurar.
 * stockCode "THYAO" veya "ISATR,ISBTR" gibi virgullu olabilir.
 */
function buildVykMemberSymbolMap(members) {
  const map = new Map();
  for (const member of members || []) {
    const companyId = member?.memberId ?? member?.mksMbrId ?? member?.companyId ?? member?.mkkMemberOid;
    const stockCode = String(member?.stockCode ?? '').toUpperCase();
    if (companyId === undefined || companyId === null || !stockCode) continue;
    const codes = stockCode.split(/[^A-Z0-9]+/).filter(Boolean);
    if (codes.length > 0) map.set(String(companyId), codes);
  }
  return map;
}

module.exports = {
  MKK_VYK_DEFAULT_BASE_URL,
  createMkkVykClient,
  buildVykMemberSymbolMap,
};
