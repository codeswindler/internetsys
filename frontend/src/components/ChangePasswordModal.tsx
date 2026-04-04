import { useState } from 'react';
import { Shield, Lock, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';

interface ChangePasswordModalProps {
  userId: string;
  onSuccess: () => void;
}

export default function ChangePasswordModal({ userId, onSuccess }: ChangePasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const mutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const token = localStorage.getItem('token');
      return axios.put(`${API_URL}/auth/profile`, { password: newPassword }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      toast.success('Password updated successfully! Welcome to PulseLynk.');
      
      // Update local storage user object to reflect change
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        user.forcePasswordChange = false;
        localStorage.setItem('user', JSON.stringify(user));
      }
      
      onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update password');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }
    if (password !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    mutation.mutate(password);
  };

  return (
    <div className="fixed inset-0 z-[20000] bg-slate-950/90 backdrop-blur-3xl flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-lg bg-slate-900 border border-cyan-500/30 shadow-3xl rounded-[3rem] p-10 md:p-14 animate-scale-in relative overflow-hidden">
        {/* Aesthetic Background Glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />

        <div className="relative text-center">
          <div className="w-20 h-20 bg-cyan-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-cyan-500/20 shadow-inner">
            <Shield size={40} className="text-cyan-400" />
          </div>
          
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-3 leading-tight">Security Update Required</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-10 opacity-70">Please set a private password to secure your account</p>

          <form onSubmit={handleSubmit} className="space-y-6 text-left">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-2">New Secret Password</label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-cyan-500/40">
                  <Lock size={18} />
                </div>
                <input
                  type={showPass ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-black/40 border-white/5 border focus:border-cyan-500/50 rounded-2xl py-5 pl-14 pr-14 text-white font-bold tracking-widest placeholder:text-white/10 transition-all outline-none"
                  placeholder="Min 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="space-y-2 pb-4">
              <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-2">Confirm Secret Password</label>
              <div className="relative">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-cyan-500/40">
                  <Lock size={18} />
                </div>
                <input
                  type={showPass ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-black/40 border-white/5 border focus:border-cyan-500/50 rounded-2xl py-5 pl-14 pr-14 text-white font-bold tracking-widest placeholder:text-white/10 transition-all outline-none"
                  placeholder="Repeat password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full py-6 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black uppercase tracking-[0.3em] text-xs rounded-2xl shadow-2xl shadow-cyan-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-4"
            >
              {mutation.isPending ? <RefreshCw className="animate-spin" size={18} /> : <Shield size={18} />}
              {mutation.isPending ? 'Updating...' : 'Secure Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
