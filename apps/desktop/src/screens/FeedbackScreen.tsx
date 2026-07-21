import { useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown, Minus, RefreshCw, Send } from 'lucide-react';

interface Recommendation {
  id: string;
  opportunity_id: string;
  presented_at: string;
  accepted: boolean;
  reasoning: string;
  opportunities: {
    id: string;
    title: string;
    category: string;
    score: number;
    expected_profit: number;
    source: string;
  };
  recommendation_feedback: Array<{
    outcome: string;
    actual_profit: number;
    notes: string;
  }>;
}

export default function FeedbackScreen() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({ outcome: '', profit: '', notes: '' });

  const fetchData = async () => {
    setLoading(true);
    const res = await window.cakalAPI.getRecommendations({ limit: 20 });
    if (res.data) setRecommendations(res.data as Recommendation[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const submitFeedback = async (recId: string) => {
    if (!feedbackForm.outcome) return;
    await window.cakalAPI.saveFeedback({
      recommendation_id: recId,
      outcome: feedbackForm.outcome,
      actual_profit: feedbackForm.profit ? parseFloat(feedbackForm.profit) : undefined,
      notes: feedbackForm.notes || undefined,
      want_similar: feedbackForm.outcome === 'profit',
    });
    setFeedbackPending(null);
    setFeedbackForm({ outcome: '', profit: '', notes: '' });
    fetchData();
  };

  const hasFeedback = (rec: Recommendation) =>
    rec.recommendation_feedback && rec.recommendation_feedback.length > 0;

  const outcomeBadge = (outcome: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      profit: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Kâr' },
      loss: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Zarar' },
      neutral: { bg: 'bg-zinc-700/50', text: 'text-zinc-400', label: 'Nötr' },
      skipped: { bg: 'bg-zinc-700/50', text: 'text-zinc-500', label: 'Atlandı' },
    };
    const s = map[outcome] || map.neutral;
    return <span className={`rounded-full px-2 py-0.5 text-xs ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Geri Bildirim</h1>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-amber-500/50 hover:text-amber-400"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Son Öneriler ve Sonuçları
        </h2>

        {recommendations.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-zinc-600">
              Henüz geri bildirim bekleyen öneri yok. Fırsat önerileri aldıktan sonra
              burada sonuçlarını takip edebilirsin.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {rec.opportunities?.title || 'Fırsat'}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                      <span>{rec.opportunities?.category}</span>
                      <span>•</span>
                      <span>Puan: {rec.opportunities?.score}</span>
                      <span>•</span>
                      <span>{new Date(rec.presented_at).toLocaleDateString('tr-TR')}</span>
                    </div>
                  </div>
                  {hasFeedback(rec) ? (
                    outcomeBadge(rec.recommendation_feedback[0].outcome)
                  ) : (
                    <button
                      onClick={() => setFeedbackPending(feedbackPending === rec.id ? null : rec.id)}
                      className="rounded-lg border border-amber-500/30 px-3 py-1 text-xs text-amber-400 hover:bg-amber-500/10"
                    >
                      Geri bildirim ver
                    </button>
                  )}
                </div>

                {/* Feedback form */}
                {feedbackPending === rec.id && (
                  <div className="mt-3 border-t border-zinc-800 pt-3 space-y-2">
                    <div className="flex gap-2">
                      {[
                        { key: 'profit', icon: ThumbsUp, label: 'Kâr', color: 'hover:border-emerald-500 hover:text-emerald-400' },
                        { key: 'loss', icon: ThumbsDown, label: 'Zarar', color: 'hover:border-red-500 hover:text-red-400' },
                        { key: 'neutral', icon: Minus, label: 'Nötr', color: 'hover:border-zinc-500 hover:text-zinc-400' },
                      ].map(({ key, icon: Icon, label, color }) => (
                        <button
                          key={key}
                          onClick={() => setFeedbackForm({ ...feedbackForm, outcome: key })}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            feedbackForm.outcome === key
                              ? key === 'profit' ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                                : key === 'loss' ? 'border-red-500 text-red-400 bg-red-500/10'
                                : 'border-zinc-500 text-zinc-400 bg-zinc-500/10'
                              : `border-zinc-700 text-zinc-500 ${color}`
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          {label}
                        </button>
                      ))}
                    </div>
                    {feedbackForm.outcome && (
                      <>
                        <input
                          type="number"
                          placeholder={feedbackForm.outcome === 'loss' ? 'Zarar miktarı (₺)' : 'Kâr miktarı (₺)'}
                          value={feedbackForm.profit}
                          onChange={(e) => setFeedbackForm({ ...feedbackForm, profit: e.target.value })}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/50"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Not (isteğe bağlı)"
                            value={feedbackForm.notes}
                            onChange={(e) => setFeedbackForm({ ...feedbackForm, notes: e.target.value })}
                            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/50"
                          />
                          <button
                            onClick={() => submitFeedback(rec.id)}
                            className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-400"
                          >
                            <Send className="h-3 w-3" />
                            Gönder
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Show existing feedback details */}
                {hasFeedback(rec) && rec.recommendation_feedback[0].actual_profit != null && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Sonuç: ₺{rec.recommendation_feedback[0].actual_profit.toLocaleString('tr-TR')}
                    {rec.recommendation_feedback[0].notes && ` — ${rec.recommendation_feedback[0].notes}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
