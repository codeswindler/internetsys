import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * A floating "Back to Top" button that appears when the user scrolls down.
 * Attach `id="page-top"` to the top of any page to use as explicit target.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = document.querySelector('.main-content-scroll') || window;
    const onScroll = () => {
      const y = el instanceof Window ? window.scrollY : el.scrollTop;
      setVisible(y > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTop = () => {
    const el = document.querySelector('.main-content-scroll');
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!visible) return null;

  return (
    <button
      onClick={scrollTop}
      title="Back to top"
      className="fixed bottom-[150px] right-9 z-[9999] p-2 rounded-full bg-red-600 text-white shadow-2xl flex items-center justify-center gap-1 active:scale-95 transition-all"
    >
      <ArrowUp size={14} />
      <span className="text-[10px] font-bold">V7</span>
    </button>
  );
}
