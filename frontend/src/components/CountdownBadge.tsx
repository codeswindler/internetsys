import { useCountdown } from '../hooks/useCountdown';
import { Clock, Play } from 'lucide-react';

interface Props {
  expiresAt: string | null | undefined;
  startedAt?: string | null | undefined;
  /** 'inline' = compact badge, 'block' = full display with label */
  variant?: 'inline' | 'block';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Live countdown badge. Updates every second.
 * Handles "Paused" state when the timer hasn't started yet.
 */
export function CountdownBadge({ expiresAt, startedAt, variant = 'inline', size = 'md' }: Props) {
  const cd = useCountdown(expiresAt);
  const isPaused = !startedAt && !cd.expired;

  const colorClass =
    cd.expired
      ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : isPaused
      ? 'text-cyan-400 bg-cyan-500/5 border-cyan-500/20 dashed'
      : cd.urgency === 'critical'
      ? 'text-orange-400 bg-orange-500/10 border-orange-500/30 animate-pulse'
      : cd.urgency === 'warning'
      ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
      : 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';

  if (variant === 'block') {
    return (
      <div className="flex items-center gap-3">
        {isPaused ? (
          <Play size={size === 'lg' ? 24 : 20} className="text-cyan-500/40" />
        ) : (
          <Clock size={size === 'lg' ? 24 : 20} className={cd.urgency === 'critical' && !cd.expired ? 'text-orange-400 animate-pulse' : 'text-cyan-400'} />
        )}
        <div>
          <div className="text-[10px] uppercase tracking-tighter text-slate-500 font-bold mb-0.5">
            {cd.expired ? 'Subscription' : isPaused ? 'Timer Paused' : 'Time Remaining'}
          </div>
          <div className={`font-black font-mono leading-none ${size === 'lg' ? 'text-3xl' : 'text-2xl'} ${cd.expired ? 'text-red-400' : isPaused ? 'text-cyan-500/60' : cd.urgency === 'critical' ? 'text-orange-400' : cd.urgency === 'warning' ? 'text-yellow-300' : 'text-white'}`}>
            {isPaused ? 'WAITING' : cd.formatted}
          </div>
        </div>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold whitespace-nowrap ${colorClass}`}>
      {isPaused ? <Play size={10} /> : <Clock size={10} />}
      {isPaused ? 'PAUSED' : cd.formatted}
    </span>
  );
}
