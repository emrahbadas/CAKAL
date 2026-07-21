const KAP_BASE_URL = 'https://www.kap.org.tr';
const FINANCIAL_REPORT_SUBJECT_OID = '4028328c594bfdca01594c0af9aa0057';

async function main() {
  const symbol = (process.argv[2] || 'THYAO').toUpperCase();
  const company = await searchCompany(symbol);

  if (!company) {
    console.error(`KAP sirket eslesmesi bulunamadi: ${symbol}`);
    process.exit(1);
  }

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 365 * 24 * 60 * 60 * 1000);
  const disclosures = await fetchFinancialDisclosures({
    companyId: company.companyId,
    fromDate: formatDate(fromDate),
    toDate: formatDate(toDate),
  });

  const latest = disclosures
    .map((item) => ({
      disclosureIndex: String(item.disclosureIndex || item.disclosureBasic?.disclosureIndex || ''),
      title: String(item.title || item.disclosureBasic?.title || ''),
      publishDate: String(item.publishDateTime || item.publishDate || item.disclosureBasic?.publishDate || ''),
      year: item.year,
      period: item.period || item.ruleTypeTerm || item.ruleType,
    }))
    .filter((item) => item.disclosureIndex)
    .sort((a, b) => Date.parse(normalizeKapDate(b.publishDate)) - Date.parse(normalizeKapDate(a.publishDate)))[0];

  console.log(JSON.stringify({
    success: true,
    symbol,
    company,
    disclosureCount: disclosures.length,
    latestFinancialDisclosure: latest || null,
    note: 'Bu smoke test sadece KAP bildirim listesini kontrol eder; finansal raporu tekrar indirmez.',
  }, null, 2));
}

async function searchCompany(symbol) {
  const response = await fetch(`${KAP_BASE_URL}/tr/api/search/combined`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ keyword: symbol }),
  });
  if (!response.ok) throw new Error(`KAP search failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const category = Array.isArray(data) ? data.find((item) => item.category === 'companyOrFunds') : null;
  const results = Array.isArray(category?.results) ? category.results : [];
  const match = results.find((item) => item.searchType === 'C' && String(item.cmpOrFundCode || '').toUpperCase() === symbol)
    || results.find((item) => item.searchType === 'C');
  if (!match) return null;
  return {
    name: match.searchValue,
    ticker: String(match.cmpOrFundCode || '').toUpperCase(),
    companyId: match.memberOrFundOid,
  };
}

async function fetchFinancialDisclosures(input) {
  const response = await fetch(`${KAP_BASE_URL}/tr/api/disclosure/members/byCriteria`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      fromDate: input.fromDate,
      toDate: input.toDate,
      disclosureClass: 'FR',
      subjectList: [FINANCIAL_REPORT_SUBJECT_OID],
      mkkMemberOidList: [input.companyId],
      inactiveMkkMemberOidList: [],
      bdkMemberOidList: [],
      fromSrc: false,
      disclosureIndexList: [],
    }),
  });
  if (!response.ok) throw new Error(`KAP disclosure query failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function jsonHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'CakalKapSmoke/1.0',
  };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeKapDate(value) {
  const match = String(value).match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return value;
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
