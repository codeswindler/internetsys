import { useQuery } from '@tanstack/react-query';
import { Users, Wifi, Router as RouterIcon, DollarSign } from 'lucide-react';
import api from '../../services/api';

export default function Dashboard() {
  const { data: subs, isLoading: subsLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.get('/subscriptions').then(res => res.data),
  });

  const { data: routers, isLoading: routersLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: () => api.get('/routers').then(res => res.data),
  });

  if (subsLoading || routersLoading) return <div className="text-center p-8">Loading...</div>;

  const activeSubs = subs?.filter((s: any) => s.status === 'active') || [];
  const onlineRouters = routers?.filter((r: any) => r.isOnline) || [];
  const totalRevenue = subs?.reduce((acc: number, s: any) => acc + (Number(s.amountPaid) || 0), 0) || 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="glass-panel p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-cyan-400 rounded-full opacity-10 blur-2xl"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Active Users</p>
              <h3 className="text-3xl font-bold text-white mt-1">{activeSubs.length}</h3>
            </div>
            <div className="p-3 bg-[rgba(14,165,233,0.1)] text-cyan-400 rounded-lg"><Users size={24}/></div>
          </div>
        </div>

        <div className="glass-panel p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-green-400 rounded-full opacity-10 blur-2xl"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Online Routers</p>
              <h3 className="text-3xl font-bold text-white mt-1">{onlineRouters.length} <span className="text-sm font-normal text-slate-400">/ {routers?.length || 0}</span></h3>
            </div>
            <div className="p-3 bg-[rgba(16,185,129,0.1)] text-green-400 rounded-lg"><RouterIcon size={24}/></div>
          </div>
        </div>

        <div className="glass-panel p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-400 rounded-full opacity-10 blur-2xl"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Total Sessions</p>
              <h3 className="text-3xl font-bold text-white mt-1">{subs?.length || 0}</h3>
            </div>
            <div className="p-3 bg-[rgba(168,85,247,0.1)] text-purple-400 rounded-lg"><Wifi size={24}/></div>
          </div>
        </div>

        <div className="glass-panel p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-amber-400 rounded-full opacity-10 blur-2xl"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium">Total Revenue</p>
              <h3 className="text-3xl font-bold text-white mt-1">KES {totalRevenue.toFixed(0)}</h3>
            </div>
            <div className="p-3 bg-[rgba(245,158,11,0.1)] text-amber-400 rounded-lg"><DollarSign size={24}/></div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-6">
        <h3 className="text-lg font-bold mb-4">Recent Subscriptions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.05)] text-slate-400 text-sm">
                <th className="p-3 font-medium">User</th>
                <th className="p-3 font-medium">Package</th>
                <th className="p-3 font-medium">Router</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Method</th>
                <th className="p-3 font-medium">Purchased</th>
              </tr>
            </thead>
            <tbody>
              {subs?.slice(0, 5).map((s: any) => (
                <tr key={s.id} className="border-b border-[rgba(255,255,255,0.05)] last:border-0 hover:bg-[rgba(255,255,255,0.02)]">
                  <td className="p-3">{s.user.name} ({s.user.phone})</td>
                  <td className="p-3">{s.package.name}</td>
                  <td className="p-3">{s.router.name}</td>
                  <td className="p-3">
                    <span className={`badge ${s.status === 'active' ? 'badge-success' : s.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="p-3">{s.paymentMethod}</td>
                  <td className="p-3 text-slate-400 text-sm">{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {subs?.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-500">No subscriptions found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
