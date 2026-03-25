import { useCountdown } from '../hooks/useCountdown';
import { Clock } from 'lucide-react';

interface Props {
  expiresAt: string | null | undefined;
  /** 'inline' = compact badge, 'block' = full display with label */
  variant?: 'inline' | 'block';
}

/**
 * Live countdown badge. Updates every second.
 */
export function CountdownBadge({ expiresAt, variant = 'inline' }: Props) {
  const cd = useCountdown(expiresAt);

  const colorClass =
    cd.expired
      ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : cd.urgency === 'critical'
      ? 'text-orange-400 bg-orange-500/10 border-orange-500/30 animate-pulse'
      : cd.urgency === 'warning'
      ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
      : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';

  if (variant === 'block') {
    return (
      <div className="flex items-center gap-3">
        <Clock size={20} className={cd.urgency === 'critical' && !cd.expired ? 'text-orange-400 animate-pulse' : 'text-cyan-400'} />
        <div>
          <div className="text-[10px] uppercase tracking-tighter text-slate-500 font-bold mb-0.5">
            {cd.expired ? 'Subscription' : 'Time Remaining'}
          </div>
          <div className={`text-2xl font-black font-mono leading-none ${cd.expired ? 'text-red-400' : cd.urgency === 'critical' ? 'text-orange-400' : cd.urgency === 'warning' ? 'text-yellow-300' : 'text-white'}`}>
            {cd.formatted}
          </div>
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold whitespace-nowrap ${colorClass}`}>
      <Clock size={10} />
      {cd.formatted}
    </span>
  );
}
