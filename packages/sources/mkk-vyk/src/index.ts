import type { SourceAdapter, SourceSearchOptions, SourceSignal } from '../../base/src';
import type { KapCompany, KapDisclosure } from '../../../core/investment-research/src';

export const MKK_VYK_DEFAULT_BASE_URL = 'https://apigwdev.mkk.com.tr/api/vyk';

export interface MkkVykAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  /**
   * MKK API Portal token'i. apigwdev gateway'i canli testte yalniz Basic
   * (API_KEY:API_SECRET) kabul etti; bu token Bearer olarak yalnizca
   * key/secret tanimli DEGILSE denenir (ileride prod gateway icin).
   */
  apiToken?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  userAgent?: string;
}

export interface MkkVykMember {
  title?: string;
  stockCode?: string;
  memberType?: string;
  kfifUrl?: string;
  mkkMemberOid?: string;
  mksMbrId?: string;
  memberId?: string | number;
  [key: string]: unknown;
}

export interface MkkVykDisclosureInfo {
  disclosureIndex?: string;
  disclosureType?: string;
  disclosureClass?: string;
  subReportIds?: string[];
  title?: string;
  companyId?: string;
  fundId?: string;
  fundCode?: string;
  acceptedDataFileTypes?: string[];
  [key: string]: unknown;
}

export interface MkkVykDisclosureDetail {
  disclosureIndex?: string;
  senderId?: string;
  senderTitle?: string;
  senderExchCodes?: string[];
  disclosureType?: string;
  disclosureClass?: string;
  subject?: { tr?: string; en?: string };
  consolidation?: string;
  year?: string;
  period?: { tr?: string; en?: string };
  relatedStocks?: Array<{ code?: string }>;
  summary?: { tr?: string; en?: string };
  time?: string;
  link?: string;
  attachmentUrls?: Array<{ url?: string; fileName?: string }>;
  htmlMessages?: Array<{ id?: string; tr?: string; en?: string }>;
  flatData?: Array<{ id?: string; content?: unknown }>;
  presentation?: Array<{ id?: string; content?: unknown }>;
  [key: string]: unknown;
}

export interface MkkVykDisclosuresQuery {
  disclosureIndex: string | number;
  disclosureTypes?: string;
  disclosureClass?: string;
  companyId?: Array<string | number> | string | number;
}

export interface MkkVykDisclosureDetailQuery {
  disclosureIndex: string | number;
  fileType: string;
  subReportList?: string[] | string;
}

export class MkkVykApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(input: { status: number; statusText: string; body: string; url: string }) {
    const productHint = input.status === 401 || input.status === 403
      ? ' API product aboneligi/erisimi eksik olabilir.'
      : '';
    super(`MKK VYK request failed: ${input.status} ${input.statusText}.${productHint} url=${input.url}`);
    this.name = 'MkkVykApiError';
    this.status = input.status;
    this.statusText = input.statusText;
    this.body = input.body;
  }
}

export class MkkVykAdapter implements SourceAdapter {
  readonly id = 'mkk-vyk';
  readonly name = 'MKK KAP VYK API';
  readonly type = 'api' as const;
  readonly active = true;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly apiToken?: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private lastRequestAt = 0;

  constructor(options: MkkVykAdapterOptions = {}) {
    this.baseUrl = removeTrailingSlash(options.baseUrl ?? MKK_VYK_DEFAULT_BASE_URL);
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.apiToken = options.apiToken;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.minIntervalMs = options.minIntervalMs ?? 12000;
    this.userAgent = options.userAgent ?? 'CakalMkkVykAdapter/1.0';
  }

  static fromEnv(env: Record<string, string | undefined> = globalThis.process?.env ?? {}): MkkVykAdapter {
    return new MkkVykAdapter({
      baseUrl: env.MKK_VYK_BASE_URL,
      apiKey: env.MKK_VYK_API_KEY,
      apiSecret: env.MKK_VYK_API_SECRET,
      apiToken: env.MKK_VYK_API_TOKEN,
      minIntervalMs: env.MKK_VYK_MIN_INTERVAL_MS ? Number(env.MKK_VYK_MIN_INTERVAL_MS) : undefined,
    });
  }

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    const members = await this.fetchMembers();
    const normalizedQuery = normalizeText(query);
    const maxResults = options?.maxResults ?? 10;
    return members
      .filter((member) => {
        const haystack = normalizeText(`${member.stockCode ?? ''} ${member.title ?? ''}`);
        return normalizedQuery.length === 0 || haystack.includes(normalizedQuery);
      })
      .slice(0, maxResults)
      .map((member) => mkkMemberToSignal(member));
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchLastDisclosureIndex();
      return true;
    } catch {
      return false;
    }
  }

  async fetchMembers(): Promise<MkkVykMember[]> {
    return normalizeArray(await this.fetchJson<unknown>('/members'));
  }

  async fetchMemberSecurities(): Promise<unknown> {
    return this.fetchJson<unknown>('/memberSecurities');
  }

  async fetchMemberDetail(id: string | number): Promise<unknown> {
    return this.fetchJson<unknown>(`/memberDetail/${encodeURIComponent(String(id))}`);
  }

  async fetchLastDisclosureIndex(): Promise<string> {
    const data = await this.fetchJson<unknown>('/lastDisclosureIndex');
    if (isRecord(data) && data.lastDisclosureIndex !== undefined) return String(data.lastDisclosureIndex);
    return String(data);
  }

  async fetchDisclosures(query: MkkVykDisclosuresQuery): Promise<MkkVykDisclosureInfo[]> {
    return normalizeArray(await this.fetchJson<unknown>('/disclosures', { ...query }));
  }

  async fetchDisclosureDetail(query: MkkVykDisclosureDetailQuery): Promise<MkkVykDisclosureDetail> {
    return this.fetchJson<MkkVykDisclosureDetail>(`/disclosureDetail/${encodeURIComponent(String(query.disclosureIndex))}`, {
      fileType: query.fileType,
      subReportList: query.subReportList,
    });
  }

  async fetchBlockedDisclosures(): Promise<unknown> {
    return this.fetchJson<unknown>('/blockedDisclosures');
  }

  async fetchFunds(query: Record<string, unknown> = {}): Promise<unknown[]> {
    return normalizeArray(await this.fetchJson<unknown>('/funds', query));
  }

  toKapCompany(member: MkkVykMember, retrievedAt = new Date().toISOString()): KapCompany {
    return {
      symbol: String(member.stockCode ?? '').toUpperCase(),
      kapMemberId: member.mkkMemberOid ? String(member.mkkMemberOid) : member.mksMbrId ? String(member.mksMbrId) : undefined,
      title: String(member.title ?? ''),
      market: 'BIST',
      statementProfile: 'INDUSTRIAL',
      isActive: true,
      sourceUrl: member.kfifUrl ? String(member.kfifUrl) : undefined,
      retrievedAt,
    };
  }

  toKapDisclosure(disclosure: MkkVykDisclosureInfo | MkkVykDisclosureDetail, symbol: string, retrievedAt = new Date().toISOString()): KapDisclosure {
    const disclosureIndex = String(disclosure.disclosureIndex ?? '');
    const detail = disclosure as MkkVykDisclosureDetail;
    const info = disclosure as MkkVykDisclosureInfo;
    return {
      disclosureId: disclosureIndex,
      symbol: symbol.toUpperCase(),
      title: String(info.title ?? detail.summary?.tr ?? detail.subject?.tr ?? 'MKK KAP bildirimi'),
      disclosureType: String(disclosure.disclosureType ?? disclosure.disclosureClass ?? 'UNKNOWN'),
      publishedAt: normalizeMkkDate(detail.time ?? retrievedAt),
      kapUrl: detail.link ? String(detail.link) : `https://www.kap.org.tr/tr/Bildirim/${disclosureIndex}`,
      hasFinancialReport: String(disclosure.disclosureType ?? disclosure.disclosureClass ?? '').toUpperCase() === 'FR',
      rawMetadata: { ...disclosure, source: 'mkk-vyk' },
    };
  }

  private async fetchJson<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(path, query);
    const response = await this.fetchWithTimeout(url);
    const text = await response.text();
    if (!response.ok) {
      throw new MkkVykApiError({
        status: response.status,
        statusText: response.statusText,
        body: text,
        url,
      });
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    this.assertConfigured();
    await this.waitForRateLimit();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, */*;q=0.8',
          Authorization: this.apiKey && this.apiSecret
            ? `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`
            : `Bearer ${this.apiToken}`,
          'User-Agent': this.userAgent,
        },
      });
      this.lastRequestAt = Date.now();
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForRateLimit(): Promise<void> {
    if (this.minIntervalMs <= 0 || this.lastRequestAt === 0) return;
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = this.minIntervalMs - elapsed;
    if (waitMs > 0) await sleep(waitMs);
  }

  private assertConfigured() {
    if (this.apiKey && this.apiSecret) return;
    if (!this.apiToken) {
      throw new Error('MKK_VYK_API_KEY + MKK_VYK_API_SECRET (veya MKK_VYK_API_TOKEN) gerekli.');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mkkMemberToSignal(member: MkkVykMember, fetchedAt = new Date().toISOString()): SourceSignal {
  const symbol = String(member.stockCode ?? '').toUpperCase();
  return {
    sourceId: `mkk-vyk-member-${symbol || stableId(JSON.stringify(member))}`,
    sourceName: 'MKK KAP VYK API',
    title: symbol ? `${symbol} - ${String(member.title ?? '')}` : String(member.title ?? 'MKK KAP uyesi'),
    description: `MKK KAP uyesi. memberType=${String(member.memberType ?? 'UNKNOWN')}`,
    currency: 'N/A',
    url: member.kfifUrl ? String(member.kfifUrl) : 'https://www.kap.org.tr',
    category: 'finance',
    urgencyHints: ['official_source', 'mkk_vyk_member'],
    rawData: { ...member },
    fetchedAt,
  };
}

export function normalizeMkkDate(value: string): string {
  const trMatch = value.match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (trMatch) {
    const [, day, month, year, hour = '00', minute = '00', second = '00'] = trMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (isRecord(data)) {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u');
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
