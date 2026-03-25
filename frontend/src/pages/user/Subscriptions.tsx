import { useQuery } from '@tanstack/react-query';
import { Wifi, Clock, Activity, Lock, Router as RouterIcon, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const { data: subs, isLoading } = useQuery({
    queryKey: ['my_subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 10000,
  });

  const activeSub = subs?.find((s: any) => s.status === 'active');
  const pastSubs = subs?.filter((s: any) => s.status !== 'active') || [];

  if (isLoading) return (
    <div className="flex items-center justify-center p-16 text-slate-400 gap-3">
      <Clock className="animate-spin" size={20} /> Loading your subscriptions...
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">My Connection History</h2>
        <p className="text-slate-400">View your active Wi-Fi credentials and past sessions.</p>
      </div>

      {activeSub && (
        <div className="mb-10 animate-fade-in">
          <h3 className="text-sm font-bold tracking-widest text-cyan-400 uppercase mb-4 flex items-center gap-2">
            <Activity size={16} className="animate-pulse" /> Active Session
          </h3>
          
          <div className="glass-panel p-8 relative overflow-hidden border-cyan-500/30 shadow-[0_0_30px_rgba(14,165,233,0.15)] bg-gradient-to-br from-[#0f172a] to-[rgba(14,165,233,0.1)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 blur-[80px] rounded-full pointer-events-none"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
              <div>
                <h4 className="text-3xl font-black text-white mb-2">{activeSub.package.name}</h4>
                <div className="flex items-center gap-2 text-slate-300">
                  <RouterIcon size={16} /> Connected to <span className="font-medium text-white">{activeSub.router.name}</span>
                </div>
              </div>

              <div className="bg-black/40 backdrop-blur-md p-5 rounded-2xl border border-white/10 w-full md:w-auto">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Lock size={14}/> {activeSub.router.connectionMode === 'pppoe' ? 'Home Router Credentials (PPPoE)' : 'Hotspot Credentials'}
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center gap-6 text-sm">
                    <span className="text-slate-400">Username:</span>
                    <span className="font-mono font-bold text-cyan-400 text-lg tracking-wider bg-cyan-950/50 px-3 py-1 rounded inline-block">
                      {activeSub.mikrotikUsername}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-6 text-sm">
                    <span className="text-slate-400">Password:</span>
                    <span className="font-mono font-bold text-cyan-400 text-lg tracking-wider bg-cyan-950/50 px-3 py-1 rounded inline-block">
                      {activeSub.mikrotikPassword}
                    </span>
                  </div>
                </div>
                
                {activeSub.router.connectionMode === 'pppoe' ? (
                  <div className="mt-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-[10px] text-purple-300 leading-relaxed max-w-[240px]">
                    <strong>Instructions:</strong> Enter these details into your home router's WAN settings (Select <strong>PPPoE</strong> model). Contact support if you need help with setup.
                  </div>
                ) : (
                  <form action={`http://${activeSub.router.host}/login`} method="post" className="mt-4">
                    <input type="hidden" name="username" value={activeSub.mikrotikUsername} />
                    <input type="hidden" name="password" value={activeSub.mikrotikPassword} />
                    <input type="hidden" name="dst" value={window.location.origin} />
                    <button type="submit" className="w-full btn-primary flex items-center justify-center gap-2 py-2.5 shadow-lg shadow-cyan-500/20">
                      <ExternalLink size={16} /> 1-Click Connect
                    </button>
                    <p className="text-[10px] text-slate-500 mt-3 text-center">Connected locally? Click above to log in automatically.</p>
                  </form>
                )}
              </div>
            </div>

            {/* Countdown section */}
            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 relative z-10">
              <CountdownBadge expiresAt={activeSub.expiresAt} variant="block" />
              
              <div className="text-xs text-slate-500 bg-slate-800/50 px-3 py-2 rounded-lg border border-white/5">
                Expires on {new Date(activeSub.expiresAt).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {!activeSub && !isLoading && (
        <div className="mb-10 glass-panel p-8 text-center text-slate-400 border border-dashed border-slate-700">
          <Wifi size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="font-medium">No active subscription</p>
          <p className="text-sm text-slate-500 mt-1">Contact your ISP to activate a plan.</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase mb-4">Past Sessions</h3>
        
        {pastSubs.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-400">
            No past subscriptions found.
          </div>
        ) : (
          <div className="grid gap-4">
            {pastSubs.map((sub: any) => (
              <div key={sub.id} className="glass-panel p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${sub.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Wifi size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-lg">{sub.package.name}</h4>
                    <p className="text-sm text-slate-400 mt-1">Via {sub.router.name}</p>
                  </div>
                </div>
                
                <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                  <span className={`badge shrink-0 ${sub.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                    {sub.status === 'pending' ? 'Pending Validation' : 'Expired'}
                  </span>
                  
                  {/* Show countdown if still pending and has expiry */}
                  {sub.status === 'pending' && sub.expiresAt && (
                    <CountdownBadge expiresAt={sub.expiresAt} variant="inline" />
                  )}

                  <span className="text-xs text-slate-500 text-right">
                    {sub.status === 'pending' ? 'Requested: ' : 'Expired: '} 
                    {sub.expiresAt
                      ? new Date(sub.expiresAt).toLocaleDateString()
                      : new Date(sub.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
