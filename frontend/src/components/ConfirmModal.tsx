import React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[99999] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="glass-panel w-full max-w-sm animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 shrink-0">
              <AlertCircle size={20} />
            </div>
            <h3 className="text-lg font-bold text-white leading-tight">{title}</h3>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
        </div>
        
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/5 bg-black/20">
          <button 
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelText}
          </button>
          <button 
            className="px-5 py-2 rounded-lg text-sm font-bold bg-red-500/90 hover:bg-red-500 text-white shadow-lg transition-all transform active:scale-95 disabled:opacity-50"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
