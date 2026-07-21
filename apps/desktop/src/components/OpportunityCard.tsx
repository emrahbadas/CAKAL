import { TrendingUp, ExternalLink, Clock } from 'lucide-react';
import type { Opportunity } from '../state/chatStore';

interface Props {
  opportunity: Opportunity;
}

const scoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
};

export default function OpportunityCard({ opportunity }: Props) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
          {opportunity.category}
        </span>
        <span className={`text-sm font-bold ${scoreColor(opportunity.score)}`}>
          {opportunity.score}
        </span>
      </div>

      <h3 className="mb-1 text-sm font-medium text-zinc-200">{opportunity.title}</h3>
      <p className="mb-3 text-xs text-zinc-500 line-clamp-2">{opportunity.description}</p>

      <div className="flex items-center justify-between text-xs text-zinc-600">
        <div className="flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          <span>{opportunity.expectedProfit}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{opportunity.timeframe}</span>
        </div>
      </div>

      {opportunity.url && (
        <a
          href={opportunity.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-xs text-amber-500 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Kaynağa git
        </a>
      )}
    </div>
  );
}
