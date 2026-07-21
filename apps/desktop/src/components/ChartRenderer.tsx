import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';

// ─── Types ───────────────────────────────────────────────
export interface ChartConfig {
  type: 'trend' | 'comparison' | 'distribution' | 'kpi';
  title: string;
  subtitle?: string;
  data: Record<string, any>[];
  xKey?: string;
  yKey?: string;
  series?: { key: string; label: string; color?: string; yAxisId?: string }[];
  dualAxis?: boolean; // true = 2 Y ekseni (farklı ölçek serileri için, ör: USD/TRY + gram altın)
  kpis?: KpiItem[];
  verdict?: string;
  verdictType?: 'positive' | 'negative' | 'neutral';
}

interface KpiItem {
  label: string;
  value: string;
  change?: string;
  direction?: 'up' | 'down' | 'stable';
  status?: 'good' | 'bad' | 'neutral';
}

// ─── Color Palette ───────────────────────────────────────
const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
const STATUS_COLORS = { good: '#10b981', bad: '#ef4444', neutral: '#f59e0b' };
const DIRECTION_ICONS = { up: '▲', down: '▼', stable: '→' };

// ─── Formatters ──────────────────────────────────────────
function formatTRY(v: number) {
  if (v >= 1_000_000) return `₺${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₺${(v / 1_000).toFixed(0)}K`;
  return `₺${v}`;
}

function formatPercent(v: number) {
  return `%${v.toFixed(1)}`;
}

function autoFormat(v: any) {
  if (typeof v !== 'number') return v;
  if (v > 1000) return formatTRY(v);
  if (v < 100 && v > 0) return formatPercent(v);
  return v.toString();
}

function formatTooltipEntry(value: unknown, name: unknown): [string | number, string] {
  return [autoFormat(value), String(name ?? 'Değer')];
}

// ─── KPI Panel ───────────────────────────────────────────
function KpiPanel({ kpis }: { kpis: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {kpis.map((kpi, i) => (
        <div key={i} className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{kpi.label}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-zinc-100">{kpi.value}</span>
            {kpi.change && (
              <span
                className="text-xs font-medium"
                style={{ color: STATUS_COLORS[kpi.status || 'neutral'] }}
              >
                {DIRECTION_ICONS[kpi.direction || 'stable']} {kpi.change}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Trend Chart (Line) — supports dual Y-axis ─────────
function TrendChart({ config }: { config: ChartConfig }) {
  const xKey = config.xKey || 'name';
  const series = config.series || [{ key: config.yKey || 'value', label: 'Değer', color: COLORS[0] }];
  const dual = config.dualAxis && series.length >= 2;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={config.data} margin={{ top: 5, right: dual ? 60 : 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey={xKey} tick={{ fill: '#999', fontSize: 11 }} />
        {dual ? (
          <>
            <YAxis yAxisId="left" tick={{ fill: series[0].color || COLORS[0], fontSize: 11 }} tickFormatter={autoFormat} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: series[1].color || COLORS[1], fontSize: 11 }} tickFormatter={autoFormat} />
          </>
        ) : (
          <YAxis tick={{ fill: '#999', fontSize: 11 }} tickFormatter={autoFormat} />
        )}
        <Tooltip
          contentStyle={{ backgroundColor: '#1f1f23', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#aaa' }}
          formatter={(value, name) => formatTooltipEntry(value, name)}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#ccc' }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color || COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            {...(dual ? { yAxisId: i === 0 ? 'left' : 'right' } : {})}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Comparison Chart (Bar) ──────────────────────────────
function ComparisonChart({ config }: { config: ChartConfig }) {
  const xKey = config.xKey || 'name';
  const series = config.series || [{ key: config.yKey || 'value', label: 'Değer', color: COLORS[0] }];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={config.data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis dataKey={xKey} tick={{ fill: '#999', fontSize: 11 }} />
        <YAxis tick={{ fill: '#999', fontSize: 11 }} tickFormatter={autoFormat} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1f1f23', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#aaa' }}
          formatter={(value, name) => formatTooltipEntry(value, name)}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color || COLORS[i % COLORS.length]}
            radius={[4, 4, 0, 0]}
          >
            {config.data.map((_, idx) => (
              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Distribution Chart (Pie) ────────────────────────────
function DistributionChart({ config }: { config: ChartConfig }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={config.data}
          dataKey={config.yKey || 'value'}
          nameKey={config.xKey || 'name'}
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }) => `${String(name ?? '')} ${(((percent ?? 0) * 100)).toFixed(0)}%`}
          labelLine={{ stroke: '#666' }}
        >
          {config.data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: '#1f1f23', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
          formatter={(value: any) => [autoFormat(value)]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#999' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── Empty State ─────────────────────────────────────────
function EmptyChart({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-[120px] text-zinc-500 text-xs">
      {message || 'Grafik verisi bulunamadı'}
    </div>
  );
}

// ─── Main ChartRenderer ──────────────────────────────────
export default function ChartRenderer({ config }: { config: ChartConfig }) {
  const hasData = config.data && config.data.length > 0;
  const hasKpis = config.kpis && config.kpis.length > 0;

  return (
    <div className="my-3 rounded-xl border border-zinc-700/50 bg-zinc-900/80 p-4">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
          📊 {config.title}
        </h3>
        {config.subtitle && (
          <p className="text-xs text-zinc-500 mt-0.5">{config.subtitle}</p>
        )}
      </div>

      {/* Chart Body */}
      {config.type === 'kpi' && (hasKpis ? <KpiPanel kpis={config.kpis!} /> : <EmptyChart />)}
      {config.type === 'trend' && (hasData ? <TrendChart config={config} /> : <EmptyChart message="Trend verisi yok — lütfen dönem verisi olan bir soru sorun" />)}
      {config.type === 'comparison' && (hasData ? <ComparisonChart config={config} /> : <EmptyChart />)}
      {config.type === 'distribution' && (hasData ? <DistributionChart config={config} /> : <EmptyChart />)}

      {/* Verdict */}
      {config.verdict && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
            config.verdictType === 'positive'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : config.verdictType === 'negative'
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {config.verdictType === 'positive' ? '✅' : config.verdictType === 'negative' ? '⛔' : '⚠️'}{' '}
          {config.verdict}
        </div>
      )}
    </div>
  );
}

// ─── Parser: extract chart blocks from AI response ───────
// Robust regex: handles \r\n, optional spaces, various backtick formats
const CHART_REGEX = /```\s*chart\s*[\r\n]+([\s\S]*?)```/gi;

export function parseChartsFromContent(content: string): { text: string; charts: ChartConfig[] } {
  const charts: ChartConfig[] = [];
  let text = content.replace(CHART_REGEX, (match, jsonStr) => {
    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (parsed.type && ['trend', 'comparison', 'distribution', 'kpi'].includes(parsed.type)) {
        // Ensure data/kpis arrays exist with defaults
        if (parsed.type === 'kpi') {
          parsed.kpis = parsed.kpis || [];
        } else {
          parsed.data = parsed.data || [];
        }
        charts.push(parsed as ChartConfig);
        return ''; // remove chart block from text
      }
    } catch {
      // malformed JSON — leave as text
    }
    return match;
  }).trim();

  // Fallback: try to find inline JSON chart objects not wrapped in code blocks
  if (charts.length === 0) {
    const jsonPattern = /\{[^{}]*"type"\s*:\s*"(trend|comparison|distribution|kpi)"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    let m;
    while ((m = jsonPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed.type) {
          if (parsed.type === 'kpi') parsed.kpis = parsed.kpis || [];
          else parsed.data = parsed.data || [];
          charts.push(parsed as ChartConfig);
          text = text.replace(m[0], '').trim();
        }
      } catch { /* skip */ }
    }
  }

  return { text, charts };
}
