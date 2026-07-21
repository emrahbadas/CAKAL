import type { SourceAdapter, SourceSearchOptions, SourceSignal } from '../../base/src';
import type {
  FinancialStatementKind,
  KapCompany,
  KapDisclosure,
  KapFinancialReport,
  RawFinancialLineItem,
} from '../../../core/investment-research/src';

const KAP_BASE_URL = 'https://www.kap.org.tr';
const FINANCIAL_REPORT_SUBJECT_OID = '4028328c594bfdca01594c0af9aa0057';
const ACTIVITY_REPORT_SUBJECT_OID = '4028328d594c04f201594c5155dd0076';

export interface KapSearchCompanyResult {
  name: string;
  ticker: string;
  companyId: string;
}

export interface KapDisclosureSearchOptions {
  symbol: string;
  companyId: string;
  fromDate: string;
  toDate: string;
  disclosureClass?: 'FR' | 'ODA' | 'DG';
  subjectOid?: string;
}

export interface KapRawDisclosure {
  disclosureIndex: string | number;
  title?: string;
  stockCode?: string;
  publishDate?: string;
  publishDateTime?: string;
  disclosureClass?: string;
  year?: number;
  period?: string;
  ruleType?: string;
  ruleTypeTerm?: string;
  summary?: string;
  disclosureBasic?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface KapAdapterOptions {
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
}

export class KapAdapter implements SourceAdapter {
  readonly id = 'kap';
  readonly name = 'KAP Public Web';
  readonly type = 'api' as const;
  readonly active = true;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: KapAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? KAP_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.userAgent = options.userAgent ?? 'CakalKapAdapter/1.0';
  }

  async search(query: string, options?: SourceSearchOptions): Promise<SourceSignal[]> {
    const companies = await this.searchCompanies(query);
    const limit = options?.maxResults ?? 10;
    return companies.slice(0, limit).map((company) => ({
      sourceId: `kap-company-${company.ticker}`,
      sourceName: this.name,
      title: `${company.ticker} - ${company.name}`,
      description: `KAP sirket eslesmesi. companyId=${company.companyId}`,
      currency: 'N/A',
      url: `${this.baseUrl}/tr/sirket/${company.ticker}`,
      category: 'finance',
      urgencyHints: ['official_source', 'kap_company'],
      rawData: { ...company },
      fetchedAt: new Date().toISOString(),
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const subjects = await this.fetchDisclosureSubjects('FR');
      return subjects.length > 0;
    } catch {
      return false;
    }
  }

  async searchCompanies(query: string): Promise<KapSearchCompanyResult[]> {
    const data = await this.fetchJson<unknown>(`${this.baseUrl}/tr/api/search/combined`, {
      method: 'POST',
      body: JSON.stringify({ keyword: query }),
    });
    return parseKapCompanySearchResults(data);
  }

  async fetchBistCompanies(): Promise<KapCompany[]> {
    const html = await this.fetchText(`${this.baseUrl}/tr/bist-sirketler`);
    return parseBistCompaniesFromHtml(html).map((company) => ({
      symbol: company.ticker,
      kapMemberId: company.companyId,
      title: company.name,
      market: 'BIST',
      sector: undefined,
      statementProfile: 'INDUSTRIAL',
      isActive: true,
      sourceUrl: `${this.baseUrl}/tr/sirket/${company.ticker}`,
      retrievedAt: new Date().toISOString(),
    }));
  }

  async fetchDisclosureSubjects(disclosureClass: 'FR' | 'ODA' | 'DG' = 'FR'): Promise<Array<Record<string, unknown>>> {
    return this.fetchJson<Array<Record<string, unknown>>>(
      `${this.baseUrl}/tr/api/disclosure/subjects/${disclosureClass}/IGS`,
      { method: 'GET' },
    );
  }

  async fetchHistoricalFinancialDisclosures(options: KapDisclosureSearchOptions): Promise<KapDisclosure[]> {
    const payload = buildHistoricalDisclosureCriteria(options);
    const data = await this.fetchJson<KapRawDisclosure[]>(
      `${this.baseUrl}/tr/api/disclosure/members/byCriteria`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return data.map((item) => kapDisclosureFromRaw(item, options.symbol, this.baseUrl));
  }

  async fetchLatestFinancialDisclosure(input: {
    symbol: string;
    companyId?: string;
    lookbackDays?: number;
  }): Promise<KapDisclosure | null> {
    const companyId = input.companyId ?? (await this.searchCompanies(input.symbol))[0]?.companyId;
    if (!companyId) return null;

    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - (input.lookbackDays ?? 365) * 24 * 60 * 60 * 1000);
    const disclosures = await this.fetchHistoricalFinancialDisclosures({
      symbol: input.symbol,
      companyId,
      fromDate: formatDate(fromDate),
      toDate: formatDate(toDate),
    });

    return disclosures.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null;
  }

  async fetchFinancialReportPage(disclosureIndex: string | number): Promise<string> {
    return this.fetchText(`${this.baseUrl}/tr/Bildirim/${disclosureIndex}`);
  }

  async fetchRawFinancialLineItems(report: KapFinancialReport): Promise<RawFinancialLineItem[]> {
    const html = await this.fetchFinancialReportPage(report.disclosureId);
    return parseFinancialReportLineItems(html, report);
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchWithTimeout(url, { method: 'GET' });
    if (!response.ok) throw new Error(`KAP request failed: ${response.status} ${response.statusText}`);
    return response.text();
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchWithTimeout(url, init);
    if (!response.ok) throw new Error(`KAP request failed: ${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent,
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildHistoricalDisclosureCriteria(options: KapDisclosureSearchOptions): Record<string, unknown> {
  return {
    fromDate: options.fromDate,
    toDate: options.toDate,
    disclosureClass: options.disclosureClass ?? 'FR',
    subjectList: [options.subjectOid ?? FINANCIAL_REPORT_SUBJECT_OID],
    mkkMemberOidList: [options.companyId],
    inactiveMkkMemberOidList: [],
    bdkMemberOidList: [],
    fromSrc: false,
    disclosureIndexList: [],
  };
}

export function parseKapCompanySearchResults(data: unknown): KapSearchCompanyResult[] {
  if (!Array.isArray(data)) return [];
  const companyCategory = data.find((item) => isRecord(item) && item.category === 'companyOrFunds') as Record<string, unknown> | undefined;
  const results = Array.isArray(companyCategory?.results) ? companyCategory.results : [];
  return results
    .filter(isRecord)
    .filter((item) => item.searchType === 'C')
    .map((item) => ({
      name: String(item.searchValue ?? ''),
      ticker: String(item.cmpOrFundCode ?? '').toUpperCase(),
      companyId: String(item.memberOrFundOid ?? ''),
    }))
    .filter((company) => company.ticker && company.companyId);
}

export function parseBistCompaniesFromHtml(html: string): KapSearchCompanyResult[] {
  const nextPayload = extractNextPayload(html);
  const source = nextPayload || html;
  const pattern = /"mkkMemberOid":"([^"]+)","kapMemberTitle":"([^"]+)","relatedMemberTitle":"([^"]*)","stockCode":"([^"]+)","cityName":"([^"]*)"/g;
  const seen = new Set<string>();
  const companies: KapSearchCompanyResult[] = [];

  for (const match of source.matchAll(pattern)) {
    const [, companyId, encodedName, , stockCodes] = match;
    const name = decodeEscapedJsonText(encodedName);
    for (const ticker of stockCodes.split(',').map((value) => value.trim()).filter(Boolean)) {
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      companies.push({ ticker, name, companyId });
    }
  }

  return companies.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function kapDisclosureFromRaw(raw: KapRawDisclosure, symbol: string, baseUrl = KAP_BASE_URL): KapDisclosure {
  const disclosureBasic = isRecord(raw.disclosureBasic) ? raw.disclosureBasic : {};
  const disclosureIndex = String(raw.disclosureIndex ?? disclosureBasic.disclosureIndex ?? '');
  const title = String(raw.title ?? disclosureBasic.title ?? 'KAP bildirimi');
  const publishedAt = normalizeKapPublishedAt(String(raw.publishDateTime ?? raw.publishDate ?? disclosureBasic.publishDate ?? new Date().toISOString()));

  return {
    disclosureId: disclosureIndex,
    symbol: String(raw.stockCode ?? disclosureBasic.stockCode ?? symbol),
    title,
    disclosureType: String(raw.disclosureClass ?? disclosureBasic.disclosureClass ?? 'FR'),
    publishedAt,
    kapUrl: `${baseUrl}/tr/Bildirim/${disclosureIndex}`,
    hasFinancialReport: /finansal|financial/i.test(title) || String(raw.disclosureClass ?? 'FR') === 'FR',
    rawMetadata: raw,
  };
}

export function parseFinancialReportLineItems(html: string, report: KapFinancialReport): RawFinancialLineItem[] {
  const decodedHtml = decodeKapReportHtml(html);
  const rowBlocks = extractDataInputRows(decodedHtml);

  return rowBlocks.flatMap((block, index) => {
    const label = readFirstClassText(block, /gwt-Label[^"']*multi-language-content[^"']*content-tr/i);
    const rawValue = readFirstClassValue(block, /taxonomy-context-value/i);
    if (!label) return [];
    return [{
      rawItemId: `${report.reportId}-raw-${index + 1}`,
      reportId: report.reportId,
      symbol: report.symbol,
      statement: inferStatementKind(label),
      rawLabel: label,
      rawValue: rawValue || null,
      sourceUrl: report.sourceUrl,
      sourceTimestamp: report.retrievedAt,
      currency: report.currency,
      unit: report.unit,
      rawPayload: { htmlRowIndex: index },
    }];
  });
}

function extractDataInputRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*class=["'][^"']*data-input-row[^"']*["'][^>]*>([\s\S]*?)(?=<tr\b[^>]*class=["'][^"']*(?:data-input-row|abstract-row)[^"']*["']|$)/gi)]
    .map((match) => match[1] ?? '');
}

function decodeKapReportHtml(html: string): string {
  return html
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

export function inferStatementKind(label: string): FinancialStatementKind {
  const normalized = normalizeText(label);
  if (/nakit|cash|faaliyetlerinden kaynaklanan|yatirim faaliyetlerinden|finansman faaliyetlerinden/.test(normalized)) return 'CASH_FLOW';
  if (/satis|hasilat|kar|zarar|gelir|gider|favok|vergi/.test(normalized)) return 'INCOME_STATEMENT';
  if (/varlik|yukumluluk|ozkaynak|sermaye|borc|borclanma|kredi|alacak|stok|maddi duran|finansal yatirim|ticari borc|turev arac/.test(normalized)) return 'BALANCE_SHEET';
  return 'NOTES';
}

export function financialReportFromDisclosure(input: {
  disclosure: KapDisclosure;
  fiscalYear?: number;
  fiscalPeriod?: string;
  basis?: 'CONSOLIDATED' | 'SOLO';
  retrievedAt?: string;
}): KapFinancialReport {
  const raw = input.disclosure.rawMetadata ?? {};
  const year = input.fiscalYear ?? (typeof raw.year === 'number' ? raw.year : new Date(input.disclosure.publishedAt).getUTCFullYear());
  const fiscalPeriod = input.fiscalPeriod ?? inferFiscalPeriod(year, String(raw.period ?? raw.ruleTypeTerm ?? raw.ruleType ?? ''));
  return {
    reportId: `kap-report-${input.disclosure.symbol}-${fiscalPeriod}-${input.disclosure.disclosureId}`,
    disclosureId: input.disclosure.disclosureId,
    symbol: input.disclosure.symbol,
    fiscalYear: year,
    fiscalPeriod,
    fiscalQuarter: inferFiscalQuarter(fiscalPeriod),
    periodType: fiscalPeriod.endsWith('Q4') ? 'ANNUAL' : 'CUMULATIVE',
    basis: input.basis ?? 'CONSOLIDATED',
    auditStatus: 'UNKNOWN',
    currency: 'TRY',
    unit: 'TRY',
    sourceUrl: input.disclosure.kapUrl,
    publishedAt: input.disclosure.publishedAt,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    rawDocumentHash: stableHash(JSON.stringify(input.disclosure.rawMetadata ?? {})),
  };
}

function extractNextPayload(html: string): string {
  const match = html.match(/self\.__next_f\.push\(\[1,(".*")\]\)\s*<\/script>/s)
    ?? html.match(/self\.__next_f\.push\(\[1,(".*")\]\)\s*$/s);
  if (!match?.[1]) return '';
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return '';
  }
}

function readFirstClassText(html: string, classPattern: RegExp): string {
  for (const tag of findTagsByClass(html, classPattern)) {
    const text = decodeHtml(stripTags(tag.content)).trim();
    if (text) return text;
  }
  return '';
}

function readFirstClassValue(html: string, classPattern: RegExp): string {
  for (const tag of findTagsByClass(html, classPattern)) {
    const title = tag.content.match(/\btitle=["']([^"']+)["']/i)?.[1]
      ?? tag.openingTag.match(/\btitle=["']([^"']+)["']/i)?.[1];
    if (title) return decodeHtml(title).trim();
    const text = decodeHtml(stripTags(tag.content)).trim();
    if (text) return text;
  }
  return '';
}

function findTagsByClass(html: string, classPattern: RegExp): Array<{ openingTag: string; content: string }> {
  const tags: Array<{ openingTag: string; content: string }> = [];
  const classPatternRegex = /\bclass=["']([^"']+)["']/gi;
  for (const match of html.matchAll(classPatternRegex)) {
    const classAttr = match[1] ?? '';
    if (!classPattern.test(classAttr)) continue;
    const tagStart = html.lastIndexOf('<', match.index);
    const tagEnd = html.indexOf('>', match.index);
    if (tagStart < 0 || tagEnd < 0) continue;
    const openingTag = html.slice(tagStart, tagEnd + 1);
    const tagName = openingTag.match(/^<([a-z0-9]+)/i)?.[1];
    if (!tagName) continue;
    const closingTag = `</${tagName}>`;
    const contentStart = tagEnd + 1;
    const contentEnd = html.indexOf(closingTag, contentStart);
    tags.push({
      openingTag,
      content: contentEnd >= 0 ? html.slice(contentStart, contentEnd) : '',
    });
  }
  return tags;
}

function normalizeKapPublishedAt(value: string): string {
  const trMatch = value.match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (trMatch) {
    const [, day, month, year, hour = '00', minute = '00', second = '00'] = trMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`).toISOString();
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

function inferFiscalPeriod(year: number, period: string): string {
  const normalized = normalizeText(period);
  if (/3|uc|i\./.test(normalized) && !/6|9|12|yillik/.test(normalized)) return `${year}Q1`;
  if (/6|alti|ii\./.test(normalized)) return `${year}Q2`;
  if (/9|dokuz|iii\./.test(normalized)) return `${year}Q3`;
  return `${year}Q4`;
}

function inferFiscalQuarter(period: string): 1 | 2 | 3 | 4 | undefined {
  if (period.endsWith('Q1')) return 1;
  if (period.endsWith('Q2')) return 2;
  if (period.endsWith('Q3')) return 3;
  if (period.endsWith('Q4')) return 4;
  return undefined;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function decodeEscapedJsonText(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
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

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export const KAP_PUBLIC_ENDPOINTS = {
  baseUrl: KAP_BASE_URL,
  financialReportSubjectOid: FINANCIAL_REPORT_SUBJECT_OID,
  activityReportSubjectOid: ACTIVITY_REPORT_SUBJECT_OID,
};
