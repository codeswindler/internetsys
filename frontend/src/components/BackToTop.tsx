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
      className="fixed bottom-[120px] right-9 z-[9000] p-2 rounded-full bg-pink-600 text-white shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95"
    >
      <ArrowUp size={14} />
    </button>
  );
}
