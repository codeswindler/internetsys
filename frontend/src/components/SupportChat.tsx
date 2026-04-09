import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, User, Check, CheckCheck } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const SupportChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ['support-messages'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/support`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    enabled: isOpen,
    refetchInterval: 3000,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['support-unread'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/support/unread`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 5000,
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/support/read`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-unread'] });
    }
  });

  useEffect(() => {
    if (isOpen) {
      markReadMutation.mutate();
    }
  }, [isOpen, messages.length]);

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/support`, { content }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['support-messages'] });
    }
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessageMutation.mutate(message);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className={`w-14 h-14 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white shadow-lg ring-1 ring-white/15 hover:shadow-cyan-500/30 transition-all hover:scale-110 active:scale-95 relative ${unreadCount > 0 ? 'animate-bounce' : ''}`}
        >
          <span className="w-8 h-8 rounded-full bg-slate-950/15 border border-white/10 flex items-center justify-center">
            <MessageCircle size={18} strokeWidth={2.6} className="text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]" />
          </span>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-slate-900 animate-pulse">
              {unreadCount}
            </span>
          )}
        </button>
      ) : (
        <div className={`
          fixed bottom-6 right-6 ${isExpanded ? 'w-[450px] h-[650px] md:w-[600px] md:h-[750px] max-w-[90vw] max-h-[85vh]' : 'w-80 h-[450px]'} 
          bg-slate-900 border border-white/10 ${isExpanded ? 'rounded-3xl' : 'rounded-2xl'} 
          shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300 transition-all
        `}>
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                <User size={18} />
              </div>
              <span className="font-bold text-white">Support Chat</span>
            </div>
            <div className="flex items-center gap-1">
               <button 
                 onClick={() => setIsExpanded(!isExpanded)} 
                 className="p-1.5 text-slate-400 hover:text-white transition-all hover:bg-white/5 rounded-lg"
                 title={isExpanded ? 'Minimize' : 'Maximize'}
               >
                 {isExpanded ? (
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v5H3M21 8h-5V3M3 16h5v5M16 21v-5h5"/></svg>
                 ) : (
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                 )}
               </button>
               <button onClick={() => setIsOpen(false)} className="p-1.5 text-slate-400 hover:text-red-400 transition-all hover:bg-white/5 rounded-lg">
                 <X size={20} />
               </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0a0f18]">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm text-center px-4">
                <MessageCircle size={40} className="mb-2 opacity-20" />
                <p>Hello! How can we help you today?</p>
              </div>
            ) : (
              messages.map((msg: any) => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                    msg.sender === 'user' 
                      ? 'bg-blue-600 text-white rounded-tr-none' 
                      : 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'
                  }`}>
                    {msg.content}
                    {msg.sender === 'user' && (
                      <div className="flex justify-end mt-1 -mr-1">
                        {msg.isReadByAdmin ? (
                          <CheckCheck size={14} className="text-emerald-400" />
                        ) : (
                          <CheckCheck size={14} className="text-white/40" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="p-3 bg-slate-800/50 border-t border-white/5 flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!message.trim() || sendMessageMutation.isPending}
              className="bg-cyan-500 text-white p-2 rounded-xl hover:bg-cyan-400 disabled:opacity-50 transition-all"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default SupportChat;
