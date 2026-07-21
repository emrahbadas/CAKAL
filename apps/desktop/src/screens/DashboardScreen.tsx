import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Activity, Eye, RefreshCw, BarChart3, PieChart } from 'lucide-react';

interface DashboardData {
  opportunitiesThisWeek: number;
  totalProfit: number;
  totalLoss: number;
  activeWatchlists: number;
  topPatterns: Array<{ name: string; confidence: number; status: string }>;
  feedbackCount: number;
  profitCount: number;
  lossCount: number;
  profile: Record<string, unknown> | null;
}

interface DailyTrend {
  label: string;
  opportunities: number;
  profit: number;
  loss: number;
  net: number;
  feedbacks: number;
}

interface TrendData {
  daily: DailyTrend[];
  categoryBreakdown: Record<string, number>;
  patternTrend: Array<{
    name: string;
    confidence: number;
    status: string;
    weights: Array<{ weight: number; date: string }>;
  }>;
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [statsRes, trendRes] = await Promise.all([
      window.cakalAPI.getDashboardStats(),
      window.cakalAPI.getTrendData(),
    ]);
    if (statsRes.data) setData(statsRes.data as DashboardData);
    if (trendRes.data) setTrend(trendRes.data as TrendData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const learningScore = Number(
    ((data?.profile as Record<string, unknown> | null)?.learning_score ??
      (data?.profile as Record<string, unknown> | null)?.engagement_score ??
      0)
  );

  const stats = [
    { label: 'Bu Hafta Fırsat', value: data?.opportunitiesThisWeek || 0, fmt: String, icon: Eye, color: 'text-blue-400' },
    { label: 'Toplam Kâr', value: data?.totalProfit || 0, fmt: (v: number) => `₺${v.toLocaleString('tr-TR')}`, icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Toplam Zarar', value: data?.totalLoss || 0, fmt: (v: number) => `₺${v.toLocaleString('tr-TR')}`, icon: TrendingDown, color: 'text-red-400' },
    { label: 'Aktif Takip', value: data?.activeWatchlists || 0, fmt: String, icon: Activity, color: 'text-amber-400' },
    { label: 'Öğrenme Skoru', value: learningScore, fmt: (v: number) => `%${v}`, icon: BarChart3, color: 'text-fuchsia-400' },
  ];

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-amber-500/50 hover:text-amber-400"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4">
        {stats.map(({ label, value, fmt, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">{label}</p>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {typeof fmt === 'function' ? fmt(value) : value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            En İyi Stratejiler
          </h2>
          {data?.topPatterns && data.topPatterns.length > 0 ? (
            <div className="space-y-3">
              {data.topPatterns.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{p.name}</span>
                  <span className="text-xs text-amber-400">{Math.round(p.confidence * 100)}% güven</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              Henüz yeterli veri yok. Sistem öğrendikçe burada en iyi stratejiler görünecek.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Son 7 Gün Özeti
          </h2>
          {data && data.feedbackCount > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-zinc-400">Toplam geri bildirim: <span className="text-zinc-200">{data.feedbackCount}</span></p>
              <p className="text-zinc-400">Kârlı: <span className="text-emerald-400">{data.profitCount}</span></p>
              <p className="text-zinc-400">Zararlı: <span className="text-red-400">{data.lossCount}</span></p>
              <p className="text-zinc-400">
                Net: <span className={data.totalProfit - data.totalLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  ₺{(data.totalProfit - data.totalLoss).toLocaleString('tr-TR')}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-600">
              Henüz aktivite yok. Fırsat taramaya başladığında burada özet görünecek.
            </p>
          )}
        </div>
      </div>

      {/* 7-Day Trend Chart */}
      {trend && trend.daily.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            7 Günlük Trend
          </h2>
          <div className="flex items-end gap-2 h-32">
            {trend.daily.map((day, i) => {
              const maxVal = Math.max(...trend.daily.map(d => Math.max(d.profit, d.loss, 1)));
              const profitH = maxVal > 0 ? (day.profit / maxVal) * 100 : 0;
              const lossH = maxVal > 0 ? (day.loss / maxVal) * 100 : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex gap-0.5 items-end h-24 w-full">
                    <div
                      className="flex-1 bg-emerald-500/60 rounded-t transition-all"
                      style={{ height: `${Math.max(profitH, 2)}%` }}
                      title={`Kâr: ₺${day.profit}`}
                    />
                    <div
                      className="flex-1 bg-red-500/60 rounded-t transition-all"
                      style={{ height: `${Math.max(lossH, 2)}%` }}
                      title={`Zarar: ₺${day.loss}`}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-600">{day.label}</span>
                  <span className={`text-[10px] ${day.net >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {day.net >= 0 ? '+' : ''}₺{day.net}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/60 rounded-sm" /> Kâr</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500/60 rounded-sm" /> Zarar</span>
          </div>
        </div>
      )}

      {/* Category Breakdown + Pattern Confidence */}
      <div className="mt-6 grid grid-cols-2 gap-6">
        {/* Category Breakdown */}
        {trend && Object.keys(trend.categoryBreakdown).length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <PieChart className="h-4 w-4 text-amber-400" />
              Kategori Dağılımı (30 gün)
            </h2>
            <div className="space-y-2">
              {Object.entries(trend.categoryBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, count]) => {
                  const total = Object.values(trend.categoryBreakdown).reduce((s, v) => s + v, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400 w-24 truncate">{cat}</span>
                      <div className="flex-1 h-2 rounded-full bg-zinc-800">
                        <div className="h-2 rounded-full bg-amber-500/70 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-zinc-500 w-8 text-right">{count}</span>
                    </div>
                  );
                })
              }
            </div>
          </div>
        )}

        {/* Pattern Confidence Trend */}
        {trend && trend.patternTrend.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Pattern Güven Seviyeleri
            </h2>
            <div className="space-y-3">
              {trend.patternTrend.map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-400 truncate max-w-[180px]">{p.name.replace(/_/g, ' ')}</span>
                    <span className="text-amber-400">%{p.confidence}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-amber-500 transition-all"
                      style={{ width: `${p.confidence}%` }}
                    />
                  </div>
                  {p.weights.length > 1 && (
                    <div className="flex items-center gap-0.5 mt-1 h-3">
                      {p.weights.map((w, wi) => (
                        <div
                          key={wi}
                          className={`flex-1 rounded-sm ${w.weight >= 0.3 ? 'bg-emerald-500/50' : w.weight >= 0 ? 'bg-zinc-600' : 'bg-red-500/50'}`}
                          style={{ height: `${Math.max(20, Math.abs(w.weight) * 100)}%` }}
                          title={`Ağırlık: ${w.weight}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
