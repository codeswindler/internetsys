import React, { useState } from 'react';
import { X, Bot, User, UserSquare2, Sparkles, Ghost, Rocket, Smile, Star, ShieldAlert } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  onSuccess: (updatedUser: any) => void;
}

export const AVATAR_OPTIONS = [
  { id: 'user', icon: User, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  { id: 'bot', icon: Bot, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  { id: 'ghost', icon: Ghost, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { id: 'rocket', icon: Rocket, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  { id: 'smile', icon: Smile, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { id: 'sparkles', icon: Sparkles, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/30' },
  { id: 'star', icon: Star, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { id: 'user-square', icon: UserSquare2, color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/30' },
  { id: 'admin', icon: ShieldAlert, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', requiresRole: 'admin' },
];

export const renderAvatar = (avatarId: string | undefined, initials: string, className = "w-8 h-8") => {
  if (!avatarId) {
    return (
      <div className={`${className} rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-cyan-400 uppercase shadow-inner`}>
        {initials}
      </div>
    );
  }

  const avatar = AVATAR_OPTIONS.find(a => a.id === avatarId);
  if (!avatar) {
    return (
      <div className={`${className} rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-cyan-400 uppercase shadow-inner`}>
        {initials}
      </div>
    );
  }

  const Icon = avatar.icon;
  return (
    <div className={`${className} rounded-full ${avatar.bg} border ${avatar.border} flex items-center justify-center shadow-inner`}>
      <Icon className={avatar.color} size={className.includes('w-16') ? 32 : (className.includes('w-12') ? 24 : 16)} />
    </div>
  );
};

export default function ProfileModal({ isOpen, onClose, currentUser, onSuccess }: ProfileModalProps) {
  const [name, setName] = useState(currentUser?.name || '');
  const [username, setUsername] = useState(currentUser?.username || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/profile', { name, username, phone, avatar }); // using post fallback matching controller
      toast.success('Profile updated successfully');
      onSuccess(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const isUserAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div 
        className="glass-panel w-full max-w-md p-6 relative animate-in fade-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-bold text-white mb-6">Edit Profile</h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-300">Choose Avatar</label>
            <div className="grid grid-cols-4 gap-3 p-4 bg-black/20 rounded-xl border border-white/5">
              {AVATAR_OPTIONS.filter(a => !a.requiresRole || (a.requiresRole === 'admin' && isUserAdmin)).map((opt) => {
                const isSelected = avatar === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAvatar(opt.id)}
                    className={`flex items-center justify-center aspect-square rounded-2xl transition-all ${
                      isSelected 
                        ? `${opt.bg} border-2 ${opt.border} scale-110 shadow-lg shadow-${opt.color.replace('text-', '')}/20` 
                        : 'bg-white/5 border border-transparent hover:bg-white/10 grayscale hover:grayscale-0'
                    }`}
                  >
                    <Icon className={isSelected ? opt.color : 'text-slate-400'} size={28} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="Your full name"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="Choose a username"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="Your phone number"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all active:scale-95 flex items-center justify-center disabled:opacity-70"
          >
            {loading ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
