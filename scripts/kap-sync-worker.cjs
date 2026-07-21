const KAP_BASE_URL = 'https://www.kap.org.tr';
const FINANCIAL_REPORT_SUBJECT_OID = '4028328c594bfdca01594c0af9aa0057';
const { processKapFinancialAnalysis } = require('./process-kap-financial-analysis.cjs');
const { createMkkVykClient, buildVykMemberSymbolMap } = require('./mkk-vyk-client.cjs');

// kap_sync_state icinde global VYK delta marker'inin tutuldugu sanal sembol.
const VYK_GLOBAL_SYMBOL = '_VYK_GLOBAL_';
// Delta bu boyuta ulasirsa sayfalama/kesilme riski var demektir; gate devre
// disi kalir ve normal sembol bazli kontrole dusulur (dogruluk > hiz).
const VYK_DELTA_MAX_ROWS = 200;

const DEFAULT_POLICY = {
  normalCheckHours: 24,
  reportingSeasonCheckHours: 6,
  postReportCorrectionWindowHours: 24,
  postReportCheckHours: 2,
  staleAfterHours: 72,
  maxNoChangeCheckHours: 72,
  errorBackoffMinutes: [5, 15, 60, 360],
};

async function runKapSyncOnce(input) {
  const supabase = input.supabaseClient;
  if (!supabase) throw new Error('supabaseClient gerekli');

  const now = input.now ? new Date(input.now) : new Date();
  const explicitSymbols = Boolean(input.symbols?.length);
  const symbols = explicitSymbols
    ? input.symbols.map((symbol) => String(symbol).toUpperCase())
    : await loadDueSymbols(supabase, now, input.limit ?? 25);

  // Resmi MKK VYK API'siyle global delta on-kapisi: son marker'dan beri hicbir
  // FR (finansal rapor) bildirimi yoksa, senkron durumundaki semboller icin
  // KAP web kontrolu tamamen atlanir. Force/explicit sembol calismalarinda
  // devre disi kalir; VYK hatasi gate'i pasiflestirir, sync'i durdurmaz.
  let vykGate = null;
  const vykGateEnabled = input.useVykGate ?? (process.env.KAP_SYNC_VYK_GATE !== '0');
  if (vykGateEnabled && !explicitSymbols && !input.force && symbols.length > 0) {
    const vykClient = input.vykClient !== undefined
      ? input.vykClient
      : createMkkVykClient({ fetchImpl: input.fetchImpl ?? fetch });
    if (vykClient) {
      vykGate = await evaluateVykDeltaGate({ supabase, vyk: vykClient, now });
    }
  }

  const results = [];
  for (const symbol of symbols.slice(0, input.limit ?? symbols.length)) {
    results.push(await syncKapFinancialReportSymbol({
      supabase,
      symbol,
      now,
      fetchImpl: input.fetchImpl ?? fetch,
      lookbackDays: input.lookbackDays ?? 365,
      force: Boolean(input.force),
      vykGate,
    }));
  }

  return {
    success: results.every((result) => result.success),
    checkedAt: now.toISOString(),
    count: results.length,
    vykGate: vykGate
      ? { active: vykGate.active, reason: vykGate.reason, deltaCount: vykGate.deltaCount, frCount: vykGate.frCount }
      : null,
    results,
  };
}

/**
 * VYK global delta kapisi.
 *
 * kap_sync_state icindeki `_VYK_GLOBAL_` satiri son gorulen global disclosure
 * index'ini tutar. Bu index'ten sonraki bildirimler tek cagriyla cekilir:
 * - Marker yoksa initialize edilir (skip yok).
 * - Delta cok buyukse veya FR satirlari sembole eslenemezse gate pasif kalir.
 * - Aksi halde `affectedSymbols` disindaki, marker zamanindan sonra kontrol
 *   edilmis semboller guvenle atlanabilir.
 */
/**
 * kap_sync_state.symbol -> kap_companies.symbol FK'si nedeniyle global marker
 * icin pasif bir sirket-yer tutucu satiri gerekir. is_active=false ve OTHER
 * profiliyle hicbir arastirma evrenine/analize girmez.
 */
async function ensureVykGlobalMarkerCompany(supabase, retrievedAt) {
  const { error } = await supabase.from('kap_companies').upsert({
    symbol: VYK_GLOBAL_SYMBOL,
    title: 'MKK VYK global sync marker (sanal kayit)',
    market: 'BIST',
    statement_profile: 'OTHER',
    is_active: false,
    retrieved_at: retrievedAt,
    raw: { note: 'vyk_delta_gate_marker', virtual: true },
    updated_at: retrievedAt,
  }, { onConflict: 'symbol' });
  if (error) throw error;
}

async function evaluateVykDeltaGate(input) {
  const { supabase, vyk, now } = input;
  const checkedAt = now.toISOString();

  let globalRow = null;
  try {
    const { data, error } = await supabase
      .from('kap_sync_state')
      .select('*')
      .eq('symbol', VYK_GLOBAL_SYMBOL)
      .eq('data_type', 'DISCLOSURE')
      .maybeSingle();
    if (error) throw error;
    globalRow = data;
  } catch (err) {
    return { active: false, reason: `vyk_state_error: ${err.message}` };
  }

  try {
    if (!globalRow?.last_disclosure_id) {
      const lastIndex = await vyk.fetchLastDisclosureIndex();
      await ensureVykGlobalMarkerCompany(supabase, checkedAt);
      await upsertKapSyncState(supabase, {
        symbol: VYK_GLOBAL_SYMBOL,
        data_type: 'DISCLOSURE',
        last_disclosure_id: lastIndex,
        last_checked_at: checkedAt,
        consecutive_no_change: 0,
        sync_status: 'fresh',
        raw: { note: 'vyk_marker_initialized', source: 'MKK_VYK', authMode: vyk.authMode },
      });
      return { active: false, reason: 'marker_initialized', marker: lastIndex };
    }

    const prevMarker = String(globalRow.last_disclosure_id);
    const prevCheckedAt = globalRow.last_checked_at ?? null;
    const rows = await vyk.fetchDisclosuresSince(prevMarker);

    const maxIndex = rows.reduce(
      (max, row) => Math.max(max, Number(row?.disclosureIndex) || 0),
      Number(prevMarker) || 0,
    );
    const frRows = rows.filter((row) => {
      const kind = String(row?.disclosureClass ?? row?.disclosureType ?? '').toUpperCase();
      return kind === 'FR';
    });

    let affectedSymbols = null;
    if (frRows.length === 0) {
      affectedSymbols = new Set();
    } else if (rows.length < VYK_DELTA_MAX_ROWS) {
      try {
        const members = await vyk.fetchMembers();
        const memberMap = buildVykMemberSymbolMap(members);
        affectedSymbols = new Set();
        for (const row of frRows) {
          const codes = memberMap.get(String(row?.companyId ?? ''));
          if (!codes) {
            // Eslenemeyen FR bildirimi: hangi sembole ait bilinmiyor, gate
            // guvenli tarafta kalir ve skip yapilmaz.
            affectedSymbols = null;
            break;
          }
          for (const code of codes) affectedSymbols.add(code);
        }
      } catch {
        affectedSymbols = null;
      }
    }

    await upsertKapSyncState(supabase, {
      symbol: VYK_GLOBAL_SYMBOL,
      data_type: 'DISCLOSURE',
      last_disclosure_id: String(maxIndex),
      last_checked_at: checkedAt,
      consecutive_no_change: rows.length === 0 ? (globalRow.consecutive_no_change ?? 0) + 1 : 0,
      sync_status: 'fresh',
      raw: {
        source: 'MKK_VYK',
        authMode: vyk.authMode,
        deltaCount: rows.length,
        frCount: frRows.length,
        prevMarker,
      },
    });

    if (rows.length >= VYK_DELTA_MAX_ROWS) {
      return { active: false, reason: 'delta_too_large', deltaCount: rows.length, frCount: frRows.length };
    }
    if (affectedSymbols === null) {
      return { active: false, reason: 'fr_symbol_mapping_unavailable', deltaCount: rows.length, frCount: frRows.length };
    }
    return {
      active: true,
      reason: frRows.length === 0 ? 'no_fr_disclosures_in_delta' : 'fr_delta_mapped',
      affectedSymbols,
      prevCheckedAt,
      deltaCount: rows.length,
      frCount: frRows.length,
    };
  } catch (err) {
    return { active: false, reason: `vyk_error: ${err.message}` };
  }
}

function canSkipViaVykGate(input) {
  const { vykGate, symbol, currentReport, syncState, now } = input;
  if (!vykGate?.active) return false;
  if (!currentReport || !syncState?.last_checked_at) return false;
  if (vykGate.affectedSymbols.has(symbol)) return false;
  // Delta yalnizca onceki marker'dan sonrasini kapsar; sembolun son basarili
  // kontrolu marker guncellemesinden eskiyse aradaki pencere delta ile
  // kapsanmaz, skip guvenli degildir.
  if (!vykGate.prevCheckedAt) return false;
  if (new Date(syncState.last_checked_at).getTime() < new Date(vykGate.prevCheckedAt).getTime()) return false;
  // Sigorta: dev gateway'in kor noktasi olabilir (id uzayi ve veri paritesi
  // resmi olarak dogrulanmadi). Skip zinciri en fazla staleAfterHours kadar
  // uzayabilir; sonrasinda gercek bir KAP web kontrolu zorunludur.
  const lastFullCheckAt = syncState.raw?.last_full_check_at ?? syncState.last_checked_at;
  const maxSkipMs = DEFAULT_POLICY.staleAfterHours * 60 * 60 * 1000;
  if (now && new Date(lastFullCheckAt).getTime() < now.getTime() - maxSkipMs) return false;
  return true;
}

async function syncKapFinancialReportSymbol(input) {
  const { supabase, symbol, now, fetchImpl } = input;
  const checkedAt = now.toISOString();

  try {
    const [currentReport, syncState] = await Promise.all([
      loadCurrentFinancialReport(supabase, symbol),
      loadKapSyncState(supabase, symbol),
    ]);

    const cacheDecision = evaluateCacheDecision({
      now,
      currentReport,
      syncState,
      force: input.force,
    });

    if (cacheDecision.decision === 'USE_DB' || cacheDecision.decision === 'BACKOFF') {
      return {
        success: true,
        symbol,
        action: cacheDecision.decision,
        reason: cacheDecision.reason,
        currentReportId: currentReport?.report_id ?? null,
        nextCheckAt: cacheDecision.nextCheckAt,
      };
    }

    // Resmi VYK delta kapisi: marker'dan beri bu sembol icin FR bildirimi
    // yoksa KAP web kontrolu (sirket arama + bildirim listesi) atlanir.
    if (canSkipViaVykGate({ vykGate: input.vykGate, symbol, currentReport, syncState, now })) {
      const consecutive = (syncState?.consecutive_no_change ?? 0) + 1;
      const nextCheckAt = calculateNextCheckAt({ now, currentReport, consecutiveNoChange: consecutive });
      await upsertKapSyncState(supabase, {
        symbol,
        data_type: 'FINANCIAL_REPORT',
        last_disclosure_id: syncState?.last_disclosure_id ?? currentReport?.disclosure_id ?? null,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
        consecutive_no_change: consecutive,
        sync_status: 'fresh',
        raw: {
          note: 'vyk_delta_skip',
          source: 'MKK_VYK',
          gateReason: input.vykGate.reason,
          // Son GERCEK KAP web kontrolu tasinir; skip zinciri bunun uzerinden
          // staleAfterHours ile sinirlanir.
          last_full_check_at: syncState?.raw?.last_full_check_at ?? syncState?.last_checked_at ?? checkedAt,
        },
      });
      return {
        success: true,
        symbol,
        action: 'VYK_DELTA_SKIP',
        reason: input.vykGate.reason,
        currentReportId: currentReport?.report_id ?? null,
        nextCheckAt,
      };
    }

    const company = await searchCompany(symbol, fetchImpl);
    if (!company) throw new Error(`KAP sirket eslesmesi bulunamadi: ${symbol}`);
    await ensureKapCompany(supabase, company, checkedAt);

    await upsertKapSyncState(supabase, {
      symbol,
      data_type: 'FINANCIAL_REPORT',
      last_disclosure_id: syncState?.last_disclosure_id ?? currentReport?.disclosure_id ?? null,
      last_checked_at: checkedAt,
      next_check_at: syncState?.next_check_at ?? null,
      consecutive_no_change: syncState?.consecutive_no_change ?? 0,
      sync_status: 'checking',
      raw: { cacheDecision },
    });

    const disclosures = await fetchFinancialDisclosures({
      companyId: company.companyId,
      fromDate: formatDate(new Date(now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000)),
      toDate: formatDate(now),
      fetchImpl,
    });
    const latest = latestDisclosure(disclosures, symbol);

    if (!latest) {
      const nextCheckAt = calculateNextCheckAt({ now, currentReport, consecutiveNoChange: syncState?.consecutive_no_change ?? 0 });
      await upsertKapSyncState(supabase, {
        symbol,
        data_type: 'FINANCIAL_REPORT',
        last_disclosure_id: syncState?.last_disclosure_id ?? currentReport?.disclosure_id ?? null,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
        consecutive_no_change: (syncState?.consecutive_no_change ?? 0) + 1,
        sync_status: 'fresh',
        raw: { note: 'financial_disclosure_not_found', last_full_check_at: checkedAt },
      });
      return { success: true, symbol, action: 'NO_DISCLOSURE_FOUND', nextCheckAt };
    }

    const latestDisclosureId = String(latest.disclosureIndex);
    if (currentReport?.disclosure_id === latestDisclosureId) {
      const nextCheckAt = calculateNextCheckAt({
        now,
        currentReport,
        consecutiveNoChange: (syncState?.consecutive_no_change ?? 0) + 1,
      });
      await upsertKapSyncState(supabase, {
        symbol,
        data_type: 'FINANCIAL_REPORT',
        last_disclosure_id: latestDisclosureId,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
        consecutive_no_change: (syncState?.consecutive_no_change ?? 0) + 1,
        sync_status: 'fresh',
        raw: { latest, last_full_check_at: checkedAt },
      });
      return {
        success: true,
        symbol,
        action: 'NO_CHANGE',
        disclosureId: latestDisclosureId,
        currentReportId: currentReport.report_id,
        nextCheckAt,
      };
    }

    const disclosure = buildKapDisclosure(latest, symbol);
    await insertIgnoreDuplicate(supabase, 'kap_disclosures', {
      disclosure_id: disclosure.disclosure_id,
      symbol,
      title: disclosure.title,
      disclosure_type: disclosure.disclosure_type,
      published_at: disclosure.published_at,
      kap_url: disclosure.kap_url,
      has_financial_report: true,
      raw_metadata: latest,
    }, 'disclosure_id');

    const report = buildKapReport({
      symbol,
      disclosure,
      rawDisclosure: latest,
      previousCurrentReport: currentReport,
      checkedAt,
      nextCheckAt: calculateNextCheckAt({ now, currentReport: { published_at: disclosure.published_at }, consecutiveNoChange: 0 }),
    });
    await insertIgnoreDuplicate(supabase, 'kap_financial_reports', report, 'report_id');

    let rawItemCount = await countRawItems(supabase, report.report_id);
    if (rawItemCount === 0) {
      const html = await fetchReportPage(latestDisclosureId, fetchImpl);
      const rawItems = parseFinancialReportLineItems(html, {
        reportId: report.report_id,
        symbol,
        sourceUrl: report.source_url,
        retrievedAt: checkedAt,
        currency: report.currency,
        unit: report.unit,
      });
      await insertRawItemsIgnoreDuplicates(supabase, rawItems);
      rawItemCount = rawItems.length;
    }

    await upsertCurrentPointer(supabase, {
      symbol,
      fiscal_period: report.fiscal_period,
      basis: report.basis,
      current_report_id: report.report_id,
      current_disclosure_id: latestDisclosureId,
      version: report.version,
      updated_at: checkedAt,
      raw: { previousReportId: currentReport?.report_id ?? null },
    });
    await upsertKapSyncState(supabase, {
      symbol,
      data_type: 'FINANCIAL_REPORT',
      last_disclosure_id: latestDisclosureId,
      last_checked_at: checkedAt,
      next_check_at: report.next_check_at,
      consecutive_no_change: 0,
      sync_status: 'changed',
      raw: { latest, reportId: report.report_id, rawItemCount, last_full_check_at: checkedAt },
    });

    const analysisResult = await processKapFinancialAnalysis({
      supabaseClient: supabase,
      symbols: [symbol],
      limit: 1,
    });

    return {
      success: analysisResult.success,
      symbol,
      action: currentReport ? 'NEW_VERSION_SAVED' : 'INITIAL_REPORT_SAVED',
      disclosureId: latestDisclosureId,
      reportId: report.report_id,
      rawItemCount,
      analysis: analysisResult.results?.[0] ?? null,
      nextCheckAt: report.next_check_at,
    };
  } catch (error) {
    const retryAfter = calculateRetryAfter(now, 0);
    await safeMarkSyncError(supabase, symbol, checkedAt, retryAfter, error);
    return {
      success: false,
      symbol,
      action: 'ERROR_BACKOFF',
      error: error.message,
      retryAfter,
    };
  }
}

async function loadDueSymbols(supabase, now, limit) {
  const { data, error } = await supabase
    .from('kap_sync_state')
    .select('symbol')
    .eq('data_type', 'FINANCIAL_REPORT')
    .or(`next_check_at.is.null,next_check_at.lte.${now.toISOString()},retry_after.lte.${now.toISOString()}`)
    .order('next_check_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  return [...new Set((data || []).map((row) => row.symbol).filter(Boolean))];
}

function evaluateCacheDecision(input) {
  if (input.force) {
    return {
      decision: 'CHECK_KAP_DISCLOSURES',
      reason: 'force=true',
      nextCheckAt: addHours(input.now, DEFAULT_POLICY.reportingSeasonCheckHours).toISOString(),
    };
  }
  if (input.syncState?.sync_status === 'backoff' && input.syncState.retry_after && new Date(input.syncState.retry_after) > input.now) {
    return {
      decision: 'BACKOFF',
      reason: 'retry_after henuz dolmadi',
      nextCheckAt: input.syncState.retry_after,
    };
  }
  if (input.currentReport && input.syncState?.next_check_at && new Date(input.syncState.next_check_at) > input.now) {
    return {
      decision: 'USE_DB',
      reason: 'next_check_at gelecekte',
      nextCheckAt: input.syncState.next_check_at,
    };
  }
  return {
    decision: 'CHECK_KAP_DISCLOSURES',
    reason: input.currentReport ? 'kontrol zamani geldi' : 'current report yok',
    nextCheckAt: calculateNextCheckAt({ now: input.now, currentReport: input.currentReport, consecutiveNoChange: input.syncState?.consecutive_no_change ?? 0 }),
  };
}

async function searchCompany(symbol, fetchImpl) {
  const response = await fetchImpl(`${KAP_BASE_URL}/tr/api/search/combined`, {
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
  const response = await input.fetchImpl(`${KAP_BASE_URL}/tr/api/disclosure/members/byCriteria`, {
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

async function fetchReportPage(disclosureIndex, fetchImpl) {
  const response = await fetchImpl(`${KAP_BASE_URL}/tr/Bildirim/${disclosureIndex}`, {
    method: 'GET',
    headers: {
      Accept: 'text/html, */*;q=0.8',
      'User-Agent': 'CakalKapSync/1.0',
    },
  });
  if (!response.ok) throw new Error(`KAP report page failed: ${response.status} ${response.statusText}`);
  return response.text();
}

function latestDisclosure(disclosures, symbol) {
  return disclosures
    .map((item) => normalizeRawDisclosure(item, symbol))
    .filter((item) => item.disclosureIndex)
    .sort((a, b) => Date.parse(normalizeKapDate(b.publishDate)) - Date.parse(normalizeKapDate(a.publishDate)))[0] ?? null;
}

function normalizeRawDisclosure(item, symbol) {
  const basic = item?.disclosureBasic || {};
  return {
    ...item,
    disclosureIndex: String(item.disclosureIndex || basic.disclosureIndex || ''),
    title: String(item.title || basic.title || ''),
    stockCode: String(item.stockCode || basic.stockCode || symbol),
    publishDate: String(item.publishDateTime || item.publishDate || basic.publishDate || new Date().toISOString()),
    year: item.year || basic.year,
    period: item.period || item.ruleTypeTerm || item.ruleType || basic.period,
  };
}

function buildKapDisclosure(raw, symbol) {
  return {
    disclosure_id: String(raw.disclosureIndex),
    symbol,
    title: raw.title || 'KAP Finansal Rapor',
    disclosure_type: 'FR',
    published_at: normalizeKapDate(raw.publishDate),
    kap_url: `${KAP_BASE_URL}/tr/Bildirim/${raw.disclosureIndex}`,
  };
}

function buildKapReport(input) {
  const year = Number(input.rawDisclosure.year) || new Date(input.disclosure.published_at).getUTCFullYear();
  const fiscalPeriod = inferFiscalPeriod(year, input.rawDisclosure.period);
  const previousVersion = input.previousCurrentReport?.version || 0;
  const version = previousVersion + 1;
  return {
    report_id: `kap-report-${input.symbol}-${fiscalPeriod}-${input.disclosure.disclosure_id}`,
    disclosure_id: input.disclosure.disclosure_id,
    symbol: input.symbol,
    fiscal_year: year,
    fiscal_period: fiscalPeriod,
    fiscal_quarter: inferFiscalQuarter(fiscalPeriod),
    period_type: fiscalPeriod.endsWith('Q4') ? 'ANNUAL' : 'CUMULATIVE',
    basis: 'CONSOLIDATED',
    audit_status: 'UNKNOWN',
    currency: 'TRY',
    unit: 'TRY',
    source_url: input.disclosure.kap_url,
    published_at: input.disclosure.published_at,
    retrieved_at: input.checkedAt,
    is_restatement: Boolean(input.previousCurrentReport),
    replaces_report_id: input.previousCurrentReport?.report_id || null,
    raw_document_hash: stableHash(JSON.stringify(input.rawDisclosure)),
    version,
    is_current: true,
    fetched_at: input.checkedAt,
    last_checked_at: input.checkedAt,
    next_check_at: input.nextCheckAt,
    validation_status: 'pending',
    validation_errors: [],
    raw: input.rawDisclosure,
  };
}

function parseFinancialReportLineItems(html, report) {
  const decodedHtml = decodeKapReportHtml(html);
  const rows = extractDataInputRows(decodedHtml);
  return rows.flatMap((row, index) => {
    const label = readFirstClassText(row, /gwt-Label[^"']*multi-language-content[^"']*content-tr/i);
    const value = readFirstClassValue(row, /taxonomy-context-value/i);
    if (!label) return [];
    return [{
      raw_item_id: `${report.reportId}-raw-${index + 1}`,
      report_id: report.reportId,
      symbol: report.symbol,
      statement: inferStatementKind(label),
      raw_label: label,
      raw_value: value || null,
      taxonomy_code: null,
      currency: report.currency,
      unit: report.unit,
      source_url: report.sourceUrl,
      source_timestamp: report.retrievedAt,
      raw_payload: { htmlRowIndex: index },
    }];
  });
}

function extractDataInputRows(html) {
  return [...html.matchAll(/<tr\b[^>]*class=["'][^"']*data-input-row[^"']*["'][^>]*>([\s\S]*?)(?=<tr\b[^>]*class=["'][^"']*(?:data-input-row|abstract-row)[^"']*["']|$)/gi)]
    .map((match) => match[1] || '');
}

function decodeKapReportHtml(html) {
  return html
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

async function ensureKapCompany(supabase, company, retrievedAt) {
  const { error } = await supabase.from('kap_companies').upsert({
    symbol: company.ticker,
    kap_member_id: company.companyId,
    title: company.name,
    market: 'BIST',
    statement_profile: 'INDUSTRIAL',
    is_active: true,
    source_url: `${KAP_BASE_URL}/tr/sirket/${company.ticker}`,
    retrieved_at: retrievedAt,
    raw: company,
    updated_at: retrievedAt,
  }, { onConflict: 'symbol' });
  if (error) throw error;
}

async function loadCurrentFinancialReport(supabase, symbol) {
  const { data: pointer, error: pointerError } = await supabase
    .from('kap_current_financial_reports')
    .select('*')
    .eq('symbol', symbol)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pointerError) throw pointerError;
  if (!pointer?.current_report_id) return null;

  const { data: report, error: reportError } = await supabase
    .from('kap_financial_reports')
    .select('*')
    .eq('report_id', pointer.current_report_id)
    .maybeSingle();
  if (reportError) throw reportError;
  return report;
}

async function loadKapSyncState(supabase, symbol) {
  const { data, error } = await supabase
    .from('kap_sync_state')
    .select('*')
    .eq('symbol', symbol)
    .eq('data_type', 'FINANCIAL_REPORT')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function insertIgnoreDuplicate(supabase, table, row, uniqueColumn) {
  const { data: existing, error: existingError } = await supabase
    .from(table)
    .select(uniqueColumn)
    .eq(uniqueColumn, row[uniqueColumn])
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;
  const { error } = await supabase.from(table).insert(row);
  if (error) throw error;
}

async function insertRawItemsIgnoreDuplicates(supabase, rows) {
  if (rows.length === 0) return;
  const reportId = rows[0].report_id;
  const { data: existingRows, error: existingError } = await supabase
    .from('kap_raw_financial_items')
    .select('raw_item_id')
    .eq('report_id', reportId);
  if (existingError) throw existingError;

  const existingIds = new Set((existingRows || []).map((row) => row.raw_item_id));
  const missing = rows.filter((row) => !existingIds.has(row.raw_item_id));
  for (let index = 0; index < missing.length; index += 100) {
    const chunk = missing.slice(index, index + 100);
    const { error } = await supabase.from('kap_raw_financial_items').insert(chunk);
    if (error) throw error;
  }
}

async function countRawItems(supabase, reportId) {
  const { count, error } = await supabase
    .from('kap_raw_financial_items')
    .select('*', { count: 'exact', head: true })
    .eq('report_id', reportId);
  if (error) throw error;
  return count || 0;
}

async function upsertCurrentPointer(supabase, row) {
  const { error } = await supabase.from('kap_current_financial_reports').upsert(row, {
    onConflict: 'symbol,fiscal_period,basis',
  });
  if (error) throw error;
}

async function upsertKapSyncState(supabase, row) {
  const { error } = await supabase.from('kap_sync_state').upsert({
    ...row,
    last_error: row.last_error ?? null,
    retry_after: row.retry_after ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'symbol,data_type' });
  if (error) throw error;
}

async function safeMarkSyncError(supabase, symbol, checkedAt, retryAfter, error) {
  try {
    await upsertKapSyncState(supabase, {
      symbol,
      data_type: 'FINANCIAL_REPORT',
      last_checked_at: checkedAt,
      next_check_at: retryAfter,
      retry_after: retryAfter,
      consecutive_no_change: 0,
      sync_status: 'backoff',
      last_error: error.message,
      raw: { stack: error.stack },
    });
  } catch {
    // Avoid masking the original sync failure.
  }
}

// Bilancolar ceyreklik yayimlanir; bir sonraki raporun beklenen penceresi
// kabaca onceki raporun yayin tarihinden ~75 gun sonra acilir (ceyrek + KAP
// bildirim suresi). Pencere acikken kontrol sikligi rapor-sezonu moduna iner.
const EXPECTED_NEXT_REPORT_DAYS = 75;

function isInExpectedReportWindow(now, currentReport) {
  const published = currentReport?.published_at ? new Date(currentReport.published_at) : null;
  if (!published) return false;
  const daysSince = (now.getTime() - published.getTime()) / (24 * 60 * 60 * 1000);
  return daysSince >= EXPECTED_NEXT_REPORT_DAYS;
}

function calculateNextCheckAt(input) {
  const now = input.now;
  const currentPublished = input.currentReport?.published_at ? new Date(input.currentReport.published_at) : null;
  if (currentPublished && now.getTime() - currentPublished.getTime() <= DEFAULT_POLICY.postReportCorrectionWindowHours * 60 * 60 * 1000) {
    return addHours(now, DEFAULT_POLICY.postReportCheckHours).toISOString();
  }
  // Yeni bilanco penceresi acildiysa fresh veri icin sik kontrol (6 saat):
  // veri DB'de suresiz durur ama "daha yenisi var mi" sorusu sezonda sıklaşır.
  if (isInExpectedReportWindow(now, input.currentReport)) {
    return addHours(now, DEFAULT_POLICY.reportingSeasonCheckHours).toISOString();
  }
  const noChange = input.consecutiveNoChange || 0;
  const hours = Math.min(DEFAULT_POLICY.maxNoChangeCheckHours, DEFAULT_POLICY.normalCheckHours * Math.max(1, Math.min(3, noChange + 1)));
  return addHours(now, hours).toISOString();
}

function calculateRetryAfter(now, errorCount) {
  const minutes = DEFAULT_POLICY.errorBackoffMinutes[Math.min(DEFAULT_POLICY.errorBackoffMinutes.length - 1, errorCount)] || 360;
  return addMinutes(now, minutes).toISOString();
}

function inferFiscalPeriod(year, period) {
  const text = normalizeText(String(period || ''));
  if (text === '1' || /3|uc|i\./.test(text) && !/6|9|12|yillik/.test(text)) return `${year}Q1`;
  if (text === '2' || /6|alti|ii\./.test(text)) return `${year}Q2`;
  if (text === '3' || /9|dokuz|iii\./.test(text)) return `${year}Q3`;
  return `${year}Q4`;
}

function inferFiscalQuarter(period) {
  if (period.endsWith('Q1')) return 1;
  if (period.endsWith('Q2')) return 2;
  if (period.endsWith('Q3')) return 3;
  if (period.endsWith('Q4')) return 4;
  return null;
}

function inferStatementKind(label) {
  const normalized = normalizeText(label);
  if (/nakit|cash|faaliyetlerinden kaynaklanan|yatirim faaliyetlerinden|finansman faaliyetlerinden/.test(normalized)) return 'CASH_FLOW';
  if (/satis|hasilat|kar|zarar|gelir|gider|favok|vergi/.test(normalized)) return 'INCOME_STATEMENT';
  if (/varlik|yukumluluk|ozkaynak|sermaye|borc|borclanma|kredi|alacak|stok|maddi duran|finansal yatirim|ticari borc|turev arac/.test(normalized)) return 'BALANCE_SHEET';
  return 'NOTES';
}

function readFirstClassText(html, classPattern) {
  for (const tag of findTagsByClass(html, classPattern)) {
    const text = decodeHtml(stripTags(tag.content)).trim();
    if (text) return text;
  }
  return '';
}

function readFirstClassValue(html, classPattern) {
  for (const tag of findTagsByClass(html, classPattern)) {
    const title = tag.content.match(/\btitle=["']([^"']+)["']/i)?.[1]
      || tag.openingTag.match(/\btitle=["']([^"']+)["']/i)?.[1];
    if (title) return decodeHtml(title).trim();
    const text = decodeHtml(stripTags(tag.content)).trim();
    if (text) return text;
  }
  return '';
}

function findTagsByClass(html, classPattern) {
  const tags = [];
  const classPatternRegex = /\bclass=["']([^"']+)["']/gi;
  for (const match of html.matchAll(classPatternRegex)) {
    const classAttr = match[1] || '';
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

function normalizeKapDate(value) {
  const match = String(value).match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  }
  const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`).toISOString();
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function jsonHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'CakalKapSync/1.0',
  };
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function normalizeText(text) {
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

function stableHash(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

module.exports = {
  runKapSyncOnce,
  syncKapFinancialReportSymbol,
  evaluateCacheDecision,
  evaluateVykDeltaGate,
  canSkipViaVykGate,
  calculateNextCheckAt,
  isInExpectedReportWindow,
  VYK_GLOBAL_SYMBOL,
  buildKapReport,
  latestDisclosure,
  parseFinancialReportLineItems,
  inferFiscalPeriod,
  inferStatementKind,
};
