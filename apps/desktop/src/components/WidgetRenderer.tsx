import { useCallback, useRef, useEffect, useState } from 'react';

// ─── Widget HTML'i sandboxed iframe içinde render eder ───
// Claude'un show_widget yaklaşımı: AI tam HTML+JS üretir, iframe'de çalışır
// Ayrı sandbox host sayfası kullanarak parent CSP'yi gevşetmeden çalışır

interface WidgetRendererProps {
  html: string;
  title?: string;
  height?: number;
}

export default function WidgetRenderer({ html, title, height }: WidgetRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(height || 420);
  const stockWidgetPathMatch = html.match(/open-analysis-file',path:'([^']+)'/);
  const stockWidgetPath = stockWidgetPathMatch ? stockWidgetPathMatch[1].replace(/\\\\/g, '\\') : null;
  const hasStockWidgetMarker = /cakal-stock-widget-v3/i.test(html);

  // Inject dark theme CSS variables + base styles into the widget HTML
  const wrappedHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --color-bg: #18181b;
      --color-text-primary: #e4e4e7;
      --color-text-secondary: #a1a1aa;
      --color-text-tertiary: #71717a;
      --color-border: #27272a;
      --color-accent: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--color-bg);
      color: var(--color-text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 16px;
      overflow: hidden;
    }
    canvas { max-width: 100%; }
  </style>
</head>
<body>
${html}
<script>
  // Auto-resize: tell parent our actual height
  const sendHeight = () => {
    const h = document.body.scrollHeight + 32;
    window.parent.postMessage({ type: 'widget-resize', height: h }, '*');
  };
  window.addEventListener('load', () => setTimeout(sendHeight, 500));
  new MutationObserver(sendHeight).observe(document.body, { childList: true, subtree: true });
</script>
</body>
</html>`;

  const sendWidgetHtml = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'cakal-widget-render', html: wrappedHtml },
      '*',
    );
  }, [wrappedHtml]);

  useEffect(() => {
    sendWidgetHtml();
  }, [sendWidgetHtml]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'widget-resize' && e.data.height) {
        setIframeHeight(Math.min(e.data.height, 800));
      }
      if (e.data?.type === 'open-analysis-file' && e.data.path) {
        (window as any).cakalAPI?.openAnalysisFile(e.data.path);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="my-3 rounded-xl border border-zinc-700/50 bg-zinc-900/80 overflow-hidden">
      {title && (
        <div className="px-4 pt-3 pb-1">
          <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            📊 {title}
          </h3>
        </div>
      )}
      {hasStockWidgetMarker && stockWidgetPath && (
        <div className="px-4 pb-2">
          <button
            onClick={() => (window as any).cakalAPI?.openAnalysisFile(stockWidgetPath)}
            className="w-full rounded-lg bg-amber-500 text-zinc-900 text-xs font-semibold py-2 hover:bg-amber-400 transition-colors"
          >
            Detayli Interaktif Grafigi Tarayicida Ac
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="widget-host.html"
        onLoad={sendWidgetHtml}
        sandbox="allow-scripts"
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          borderRadius: '0 0 12px 12px',
          background: '#18181b',
        }}
        title={title || 'Veri Görselleştirme'}
      />
    </div>
  );
}
