import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { MessageCircle, Send, User, ChevronRight, ArrowLeft, Clock, Check, CheckCheck, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const AdminSupport: React.FC = () => {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showUserDetail, setShowUserDetail] = useState(false);
  const [reply, setReply] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const { data: conversations = [], isLoading: loadingConvs } = useQuery({
    queryKey: ['admin-conversations'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/support/admin/conversations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 5000,
  });

  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['admin-messages', selectedUserId],
    queryFn: async () => {
      if (!selectedUserId) return [];
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/support/admin/conversations/${selectedUserId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    enabled: !!selectedUserId,
    refetchInterval: 3000,
  });

  const sendReplyMutation = useMutation({
    mutationFn: async (content: string) => {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/support/admin/reply`, { userId: selectedUserId, content }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['admin-messages', selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    }
  });

  useEffect(() => {
    if (selectedUserId) {
      const markRead = async () => {
        try {
          const token = localStorage.getItem('token');
          await axios.post(`${API_URL}/support/admin/read/${selectedUserId}`, {}, {
            headers: { Authorization: `Bearer ${token}` }
          });
          queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
          queryClient.invalidateQueries({ queryKey: ['admin-unread-total'] });
        } catch (err) {
          console.error('Failed to mark as read', err);
        }
      };
      markRead();
    }
  }, [selectedUserId, messages.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (reply.trim() && selectedUserId) {
      sendReplyMutation.mutate(reply);
    }
  };

  return (
    <div className="h-[calc(100vh-120px)] flex bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-white/5 overflow-hidden shadow-2xl relative">
      {/* Sidebar: Message List */}
      <div className={`w-full md:w-80 border-r border-white/5 flex-col bg-slate-900/40 ${selectedUserId ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-6 border-b border-white/5">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageCircle className="text-cyan-400" />
            Support Inbox
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="p-6 text-slate-500 animate-pulse text-center">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-10 text-center">
              <MessageCircle className="mx-auto mb-4 text-slate-700" size={48} />
              <p className="text-slate-500 font-medium">No open threads</p>
            </div>
          ) : (
            conversations.map((conv: any) => (
              <button
                key={conv.userId}
                onClick={() => setSelectedUserId(conv.userId)}
                className={`w-full p-4 flex items-center gap-4 transition-all border-b border-white/5 ${
                  selectedUserId === conv.userId ? 'bg-cyan-500/10 border-r-2 border-r-cyan-500' : 'hover:bg-white/5'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 relative font-bold text-lg shadow-inner">
                  {getInitials(conv.userName)}
                  {conv.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-slate-200 truncate">{conv.userName}</span>
                    <span className="text-[10px] text-slate-500">{formatDistanceToNow(new Date(conv.lastTime), { addSuffix: true })}</span>
                  </div>
                  <p className="text-xs text-slate-400 truncate opacity-80">{conv.lastMessage}</p>
                </div>
                <ChevronRight size={16} className="text-slate-600" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main: Chat View */}
      <div className={`flex-1 flex-col bg-[#0a0f18]/50 ${!selectedUserId ? 'hidden md:flex' : 'flex'}`}>
        {selectedUserId ? (
          <>
            {/* Thread Header */}
            <div className="p-4 bg-slate-900/60 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3 text-white">
                <button 
                  onClick={() => setSelectedUserId(null)}
                  className="md:hidden flex items-center justify-center text-slate-400 hover:text-white transition-all mr-2 pr-2"
                  title="Back to Inbox"
                >
                  <ArrowLeft size={24} />
                </button>
                <button 
                  onClick={() => setShowUserDetail(true)}
                  className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/30 transition-all active:scale-95 font-bold border border-cyan-500/20"
                  title="View Customer Details"
                >
                  {getInitials(conversations.find((c: any) => c.userId === selectedUserId)?.userName || '')}
                </button>
                <div>
                  <h3 className="font-bold">{conversations.find((c: any) => c.userId === selectedUserId)?.userName}</h3>
                  <p className="text-[10px] text-cyan-400/70 tracking-widest font-bold uppercase">Customer</p>
                </div>
              </div>
            </div>

            {/* User Details Overlay */}
            {showUserDetail && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                <div 
                  className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200"
                  onMouseLeave={() => setShowUserDetail(false)}
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-white text-lg">Customer Profile</h3>
                      <button onClick={() => setShowUserDetail(false)} className="text-slate-500 hover:text-white transition-colors">
                        <X size={20} />
                      </button>
                    </div>
                    
                    {(() => {
                      const user = messages.find((m: any) => m.sender === 'user')?.user;
                      const conv = conversations.find((c: any) => c.userId === selectedUserId);
                      return (
                        <div className="space-y-4">
                          <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
                            <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-bold text-lg border border-cyan-500/20">
                              {getInitials(conv?.userName || '')}
                            </div>
                            <div>
                              <p className="font-bold text-white">{conv?.userName || 'Customer'}</p>
                              <p className="text-xs text-slate-500 italic">Registered Customer</p>
                            </div>
                          </div>
                          
                          <div className="space-y-3 px-1">
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Phone Number</p>
                              <p className="text-sm text-slate-200 font-mono">{user?.phone || 'Not available'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Username</p>
                              <p className="text-sm text-cyan-400 font-bold">@{user?.username || 'no-username'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">User ID</p>
                              <p className="text-[10px] text-slate-600 font-mono break-all">{selectedUserId}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="p-4 bg-slate-800/50 border-t border-white/5 flex justify-end">
                    <button 
                      onClick={() => setShowUserDetail(false)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-all"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 p-6 overflow-y-auto space-y-4">
              {messages.map((msg: any) => (
                <div key={msg.id} className={`flex ${msg.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] ${msg.sender === 'admin' ? 'order-2' : ''}`}>
                    <div className={`p-4 rounded-2xl text-sm shadow-lg ${
                      msg.sender === 'admin' 
                        ? 'bg-gradient-to-tr from-cyan-600 to-blue-700 text-white rounded-tr-none' 
                        : 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'
                    }`}>
                      {msg.content}
                    </div>
                    <div className={`mt-1 flex items-center gap-1 text-[10px] text-slate-500 ${msg.sender === 'admin' ? 'justify-end' : ''}`}>
                      <Clock size={10} />
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {msg.sender === 'admin' && (
                        <span className="ml-1 -mr-1">
                          {msg.isReadByUser ? (
                            <CheckCheck size={14} className="text-emerald-400 inline" />
                          ) : (
                            <CheckCheck size={14} className="text-white/40 inline" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="p-6 bg-slate-900/40 border-t border-white/5">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type your reply to customer..."
                  className="flex-1 bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-all shadow-inner"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendReplyMutation.isPending}
                  className="bg-gradient-to-tr from-cyan-500 to-blue-600 text-white px-6 py-3 rounded-xl hover:shadow-cyan-500/20 shadow-lg disabled:opacity-50 transition-all flex items-center gap-2 font-bold"
                >
                  <Send size={18} />
                  Send
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center opacity-30">
            <MessageCircle size={100} className="mb-6 text-slate-700" />
            <h2 className="text-2xl font-bold text-slate-500">Select a conversation to reply</h2>
            <p className="mt-2 text-slate-600 font-medium">Incoming support messages will appear on the left</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSupport;
