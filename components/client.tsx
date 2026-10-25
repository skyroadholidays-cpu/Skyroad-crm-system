'use client';
import { useEffect, useState, type SelectHTMLAttributes } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps every open device in sync: re-fetches the page's data every 20s while
 * the tab is visible, and immediately when you switch back to the tab.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const el = document.activeElement;
      // don't refresh while you are typing in a field
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      router.refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    const onVis = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [router, seconds]);
  return null;
}

export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/** Auto-submits a GET filter form when a select changes. */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Copies text to the clipboard and briefly confirms. */
export function CopyButton({ text, label = 'Copy', className = 'btn btn-ghost btn-sm' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch { /* older browsers: user can select the text */ }
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    }}>{done ? 'Copied ✓' : label}</button>
  );
}
