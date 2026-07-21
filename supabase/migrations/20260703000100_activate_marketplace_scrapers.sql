UPDATE system_capabilities
SET
  status = 'active',
  description = CASE capability_name
    WHEN 'sahibinden_scan' THEN 'Sahibinden.com ilan tarama (BrowserWindow/Playwright uyumlu tarayıcı oturumu, cookie persistence)'
    WHEN 'trendyol_scan' THEN 'Trendyol kampanya ve indirim tarama (JSON API + BrowserWindow scraper fallback)'
    WHEN 'letgo_scan' THEN 'Letgo/Dolap ikinci el ilan tarama (BrowserWindow scraper)'
    ELSE description
  END,
  required_config = CASE capability_name
    WHEN 'sahibinden_scan' THEN '{"tool":"electron-browserwindow","dependency":"playwright-compatible runtime"}'::jsonb
    WHEN 'trendyol_scan' THEN '{"tool":"native-fetch+electron-browserwindow"}'::jsonb
    WHEN 'letgo_scan' THEN '{"tool":"electron-browserwindow"}'::jsonb
    ELSE required_config
  END,
  updated_at = NOW()
WHERE capability_name IN ('sahibinden_scan', 'trendyol_scan', 'letgo_scan');

UPDATE capability_gaps
SET status = 'resolved', last_triggered_at = NOW()
WHERE capability_name IN ('sahibinden_scan', 'trendyol_scan', 'letgo_scan')
  AND status <> 'resolved';

UPDATE expansion_proposals
SET status = 'accepted', resolved_at = COALESCE(resolved_at, NOW())
WHERE capability_name IN ('sahibinden_scan', 'trendyol_scan', 'letgo_scan')
  AND status = 'pending';