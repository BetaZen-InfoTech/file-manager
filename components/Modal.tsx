'use client';

import { ReactNode, useEffect } from 'react';

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  size = 'md'
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const w = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-modal relative w-full ${w} rounded-2xl border border-border bg-panel p-5 shadow-2xl shadow-black/60`}
      >
        {(title || icon) && (
          <div className="mb-4 flex items-center gap-3">
            {icon && (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
                {icon}
              </span>
            )}
            {title && <h3 className="text-base font-semibold text-white">{title}</h3>}
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-auto rounded-md p-1 text-gray-400 transition hover:bg-[#1c1c20] hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Small copy-to-clipboard button with a transient "Copied!" state. */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  return (
    <button
      type="button"
      className={`btn-secondary ${className}`}
      onClick={async (e) => {
        const el = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          const prev = el.textContent;
          el.textContent = 'Copied!';
          setTimeout(() => {
            el.textContent = prev;
          }, 1400);
        } catch {
          /* ignore */
        }
      }}
    >
      Copy
    </button>
  );
}
