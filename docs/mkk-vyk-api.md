# MKK KAP VYK API Integration

Date: 2026-07-19

## Purpose

MKK VYK is treated as an official KAP gateway source. It can be used for:

- KAP member/company list checks.
- Listed security metadata checks.
- Latest disclosure id checks.
- Disclosure list/detail retrieval.
- Attachment download routing.
- Cross-checking the public KAP web adapter.

It does not replace the investment workflow gates. It only improves source quality and reduces scraping dependency when API product access is active.

## Environment

Required variables:

```env
MKK_VYK_BASE_URL=https://apigwdev.mkk.com.tr/api/vyk
MKK_VYK_APP_ID=
MKK_VYK_API_KEY=
MKK_VYK_API_SECRET=
MKK_VYK_API_TOKEN=
MKK_VYK_MIN_INTERVAL_MS=12000
```

Auth precedence (verified live on 2026-07-19): the apigwdev gateway accepts only HTTP Basic Auth (`API_KEY:API_SECRET`); the portal `mcp_` access token was rejected (401) as Bearer and under `apikey`/`X-Api-Key`/`Token` headers, so it appears to be a portal-side token, not a gateway credential. The adapter therefore prefers Basic whenever key/secret are present and only falls back to `Authorization: Bearer <MKK_VYK_API_TOKEN>` when they are absent (kept for potential prod-gateway use).

The free product plan is documented as 6 calls/minute. Cakal uses a safer default interval of 12 seconds between MKK VYK calls, which is 5 calls/minute.

The current portal no longer exposes the old embedded `Dokuman & Test` console from the older guide. The current integration source is the OpenAPI endpoint:

`https://apigwdev.mkk.com.tr/api/vyk?openapi`

## Implemented Files

- `packages/sources/mkk-vyk/src/index.ts`
- `scripts/mkk-vyk-client.cjs` (CJS client for sync worker; Basic-first auth, 12s rate limit)
- `scripts/run-mkk-vyk-smoke.cjs`
- `tests/mkk-vyk-adapter.test.mjs`
- `tests/kap-vyk-delta-gate.test.mjs`

## KAP Sync Delta Gate (live since 2026-07-19)

`runKapSyncOnce` now runs an official-API pre-gate before per-symbol KAP web checks:

1. A global marker (last seen `disclosureIndex`) is kept in `kap_sync_state` under the virtual symbol `_VYK_GLOBAL_` (backed by an inactive placeholder row in `kap_companies` to satisfy the FK; it never enters research universes).
2. Each run fetches `GET /disclosures?disclosureIndex=<marker>` — one API call for the whole run.
3. If the delta contains no `FR` disclosures, every already-synced due symbol is skipped (`VYK_DELTA_SKIP`) without touching KAP web; if it does, affected symbols are resolved via `GET /members` (companyId -> stockCode) and only those go through the full check.
4. Safety rails: the gate deactivates (full per-symbol checks resume) on any VYK error, when the delta is suspiciously large (>=200 rows), or when an FR row cannot be mapped to a symbol. Symbols never synced, checked before the previous marker update, explicit-symbol runs and `--force` runs are never skipped.
5. Disable with `KAP_SYNC_VYK_GATE=0`.

Verified live on 2026-07-19: marker initialized at index 1231017; the second pass returned a 1-row delta with 0 FR disclosures and activated the gate.

## Disclosure Detail / Report Download (probed live 2026-07-19)

- `GET /disclosureDetail/{index}?fileType=html` works **only for FR disclosures** (200 with a ~100KB JSON carrying `senderExchCodes`, `subject` and report content); ODA/DG ids return `ER005 Bildirim bulunamadı`.
- **Critical finding:** the apigwdev gateway uses its **own disclosureIndex sequence** (~1.23M in Jul 2026) which does NOT match KAP web bildirim ids (~1.6M). A disclosure id obtained from KAP web (e.g. THYAO 2026Q1 = 1598897) returns ER005 on the gateway.
- Consequence: full-report download stays on KAP web (`/tr/Bildirim/{id}`), which is production data and matches the existing parser. `fetchDisclosureDetail` is available on the CJS client for when production gateway access (shared id space) is granted.
- Safety insurance added because dev-gateway data parity is unverified: a symbol can be skipped by the delta gate for at most `staleAfterHours` (72h) since its last real KAP web check (`raw.last_full_check_at` is carried across skips); after that a full check is forced.

## Cache / Expiry Semantics (verified against live DB 2026-07-19)

KAP data is stored in Supabase indefinitely and served DB-first; `next_check_at` is a re-check schedule, not an expiry:

- Verified tables: `kap_companies`, `kap_disclosures`, `kap_financial_reports` (versioned, THYAO 2026Q1 v3), `kap_raw_financial_items` (3505 rows), `normalized_financial_facts` (61), `financial_validation_results`, `company_financial_ratios`, `company_analysis_snapshots` (3 each), `financial_line_item_mappings` (46), `kap_current_financial_reports`, `kap_sync_state`.
- Quarterly awareness: after a report is ~75 days old (`EXPECTED_NEXT_REPORT_DAYS`), the next-report window opens and the check interval drops to `reportingSeasonCheckHours` (6h) until the new bilanço arrives; the first 24h after a new report use 2h correction checks; otherwise 24-72h adaptive.

## Spec Endpoints

- `GET /members`
- `GET /memberSecurities`
- `GET /memberDetail/{id}`
- `GET /lastDisclosureIndex`
- `GET /disclosures`
- `GET /disclosureDetail/{disclosureIndex}`
- `GET /downloadAttachment/{id}`
- `GET /blockedDisclosures`
- `GET /funds`
- `GET /fundDetail/{id}`
- `GET /caEventStatus`

## Operational Commands

- Run adapter unit tests:
  `npm test -- --run tests/mkk-vyk-adapter.test.mjs`
- Run live gateway smoke test:
  `npm run mkk:vyk-smoke`

## Current Access Status

The first live smoke test reached the gateway but returned HTTP `401 Unauthorized` with fault code `OI001`.

The OpenAPI endpoint itself returns HTTP 200. The authenticated data endpoint still returns HTTP 401.

The initial application screenshot showed `API Productlar -> Kayit bulunamadi`, while the product page indicates the free plan is active/automatic. The most likely remaining causes are:

- The application key is not actually bound to the product despite the product page showing automatic approval.
- The gateway expects a different credential pair/header than `API_KEY:API_SECRET` Basic Auth.
- The portal session/state is inconsistent after the 2026 UI change.

Required user-side action in the MKK portal:

1. Confirm the `ÇAKAL` application is bound to the `KAP VYK API` free product plan.
2. Ask MKK which exact authentication header is expected for the 2026 portal: Basic Auth with API key/secret, consumer key/secret headers, or another gateway header.
3. If no product binding is visible under the app detail, contact MKK API Portal support and ask them to enable product access for the application reference id.
4. Re-run `npm run mkk:vyk-smoke`.

Suggested support text:

> 26.06.2026 tarihli guncel urun ekraninda eski kullanim kilavuzunda bulunan Dokuman & Test, Uygulamalarim ve API Trafik sekmeleri bulunmamaktadir. Uygulamam aktif ve urun otomatik onayli gorunmektedir. Guncel arayuzde API erisim anahtarina nereden ulasilacagi ve test cagrisinin hangi kimlik dogrulama basliklariyla yapilacagi konusunda bilgi rica ederim. Ayrica portal oturumu sayfa gecislerinde duzensiz bicimde sonlanmaktadir.

## Update: 2026-07-20 — Auth RESOLVED, API live

Live smoke test (`npm run mkk:vyk-smoke` equivalent) now returns **HTTP 200**:

- `/lastDisclosureIndex` -> `{ "lastDisclosureIndex": "1231017" }` with Basic Auth (`API_KEY:API_SECRET`).
- `/disclosures?disclosureIndex=1230950` -> 200, 50 items (types observed: FON, CA/ODA, DG). No FR in that window (off-season, late night).

Portal behavior note: after logout/login the portal UI shows the per-endpoint
"Yetkilendir" lock as open again. This is **cosmetic/session-scoped** — it only
affects the portal's own "try it" panel. Server-side product access is
unaffected; API calls with the stored key/secret keep returning 200.

Full OpenAPI spec (downloaded from the portal, `apinizer-337-07a3583`) is saved
at `docs/kap-vyk-openapi.json`. Notable for FR pipeline work:

- `/disclosures` supports `disclosureTypes=FR` and `companyId` filters.
- `/disclosureDetail/{index}?fileType=data` returns `flatData` (structured
  financial line items) in addition to `htmlMessages`.
- `/downloadAttachment/{id}` downloads report attachments via `attachmentUrls`.
- Rate limit: free plan 6 calls/min; client enforces 12 s spacing.
