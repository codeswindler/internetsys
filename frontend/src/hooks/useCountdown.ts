import { useState, useEffect, useRef } from 'react';

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number; // ms remaining
  expired: boolean;
  formatted: string; // e.g. "2d 3h 14m 08s"
  urgency: 'critical' | 'warning' | 'normal'; // < 1h, < 6h, otherwise
}

function compute(expiresAt: string | null | undefined): CountdownParts {
  if (!expiresAt) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, expired: true, formatted: '—', urgency: 'critical' };
  }
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, expired: true, formatted: 'Expired', urgency: 'critical' };
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1_000);

  let formatted = '';
  if (days > 0) formatted += `${days}d `;
  formatted += `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

  const urgency: CountdownParts['urgency'] =
    diff < 3_600_000 ? 'critical' : diff < 21_600_000 ? 'warning' : 'normal';

  return { days, hours, minutes, seconds, total: diff, expired: false, formatted, urgency };
}

/**
 * Live countdown for an ISO expiry string.
 * Updates every second while the component is mounted.
 */
export function useCountdown(expiresAt: string | null | undefined): CountdownParts {
  const [parts, setParts] = useState<CountdownParts>(() => compute(expiresAt));
  const ref = useRef(expiresAt);
  ref.current = expiresAt;

  useEffect(() => {
    setParts(compute(ref.current));
    const id = setInterval(() => setParts(compute(ref.current)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return parts;
}
