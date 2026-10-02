import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from './iconRegistry';
import clsx from 'clsx';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export const Icon: React.FC<{ name?: string; className?: string; size?: number; strokeWidth?: number }> = ({ name, className, size = 16, strokeWidth = 2 }) => {
  const Cmp = (name ? (LucideIcons as unknown as Record<string, React.ComponentType<any>>)[name] : null) ?? LucideIcons.Dot;
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} />;
};

export const Badge: React.FC<{ tone?: string; children: React.ReactNode; className?: string; title?: string }> = ({ tone = 'neutral', children, className, title }) => (
  <span title={title} className={clsx('chip', `chip-${tone}`, className)}>{children}</span>
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; icon?: string; loading?: boolean }
> = ({ variant = 'default', size = 'md', icon, loading, children, className, disabled, ...rest }) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={clsx('btn', variant === 'primary' && 'btn-primary', variant === 'danger' && 'btn-danger', variant === 'ghost' && 'btn-ghost', size === 'sm' && 'btn-sm', className)}
  >
    {loading ? <LucideIcons.Loader2 size={14} className="animate-spin" /> : icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
    {children}
  </button>
);

export const Card: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: string;
  tone?: string;
}> = ({ title, subtitle, actions, children, className, bodyClassName, icon, tone }) => (
  <section className={clsx('card flex min-w-0 flex-col', className)}>
    {(title || actions) && (
      <header className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && (
            <span className={clsx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border', tone ? `chip-${tone}` : 'border-line bg-panel2 text-brand')}>
              <Icon name={icon} size={15} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] font-semibold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11.5px] text-faint">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
    )}
    <div className={clsx('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
  </section>
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <LucideIcons.Loader2 className={clsx('animate-spin text-brand', className)} size={16} />
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: string; tone?: string; className?: string }> = ({ label, value, hint, icon, tone = 'accent', className }) => (
  <div className={clsx('card flex items-center gap-3 px-3.5 py-3', className)}>
    {icon && (
      <span className={clsx('grid size-9 shrink-0 place-items-center rounded-lg border', `chip-${tone}`)}>
        <Icon name={icon} size={17} />
      </span>
    )}
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="mt-0.5 truncate text-[17px] font-semibold leading-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11.5px] text-faint">{hint}</div>}
    </div>
  </div>
);

export const ProgressBar: React.FC<{ value: number; max?: number; tone?: string; label?: string; className?: string }> = ({ value, max = 100, tone = 'accent', label, className }) => {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', accent: 'bg-brand' }[tone] ?? 'bg-brand';
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel3">
        <div className={clsx('h-full rounded-full transition-[width] duration-700', color)} style={{ width: `${pct}%` }} />
      </div>
      {label && <div className="mt-1 flex justify-between text-[10.5px] text-faint"><span>{label}</span><span>{pct.toFixed(0)}%</span></div>}
    </div>
  );
};

export const EmptyState: React.FC<{ icon?: string; title: string; hint?: React.ReactNode; action?: React.ReactNode; className?: string }> = ({ icon = 'Inbox', title, hint, action, className }) => (
  <div className={clsx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
    <span className="grid size-11 place-items-center rounded-xl border border-line bg-panel2 text-faint"><Icon name={icon} size={20} /></span>
    <div className="text-sm font-medium text-dim">{title}</div>
    {hint && <div className="max-w-md text-[12px] leading-relaxed text-faint">{hint}</div>}
    {action && <div className="mt-1">{action}</div>}
  </div>
);

export const Toolbar: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={clsx('flex flex-wrap items-center gap-2', className)}>{children}</div>
);

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }> = ({ open, onClose, title, subtitle, children, footer, wide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={clsx('animate-in card my-4 w-full shadow-2xl', wide ? 'max-w-4xl' : 'max-w-2xl')}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-faint">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></Button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
};

export const Drawer: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: string }> = ({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={clsx('animate-in flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-faint">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></Button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Form controls
 * ------------------------------------------------------------------ */

export const Field: React.FC<{ label: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string }> = ({ label, hint, required, children, className }) => (
  <label className={clsx('block', className)}>
    <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-dim">
      {label}
      {required && <span className="text-bad">*</span>}
    </span>
    {children}
    {hint && <span className="mt-1 block text-[11px] leading-snug text-faint">{hint}</span>}
  </label>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx('inline-flex items-center gap-2 text-[12.5px] disabled:opacity-50', disabled && 'cursor-not-allowed')}
  >
    <span className={clsx('relative h-[18px] w-[32px] rounded-full border transition-colors', checked ? 'border-brand/50 bg-brand/30' : 'border-line bg-panel3')}>
      <span className={clsx('absolute top-[2px] size-3 rounded-full transition-all', checked ? 'left-[16px] bg-brand' : 'left-[2px] bg-faint')} />
    </span>
    {label && <span className="text-dim">{label}</span>}
  </button>
);

export const Segmented: React.FC<{ value: string; onChange: (v: string) => void; options: Array<{ value: string; label: React.ReactNode; icon?: string }>; className?: string }> = ({ value, onChange, options, className }) => (
  <div className={clsx('inline-flex rounded-lg border border-line bg-panel2 p-0.5', className)}>
    {options.map((o) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        className={clsx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
          value === o.value ? 'bg-panel3 text-ink' : 'text-faint hover:text-dim')}
      >
        {o.icon && <Icon name={o.icon} size={13} />}
        {o.label}
      </button>
    ))}
  </div>
);

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; title: string; message?: string; hint?: string }

type Listener = (toasts: Toast[]) => void;
const listeners = new Set<Listener>();
let toasts: Toast[] = [];
let toastId = 0;

const emit = () => listeners.forEach((l) => l([...toasts]));

export const toast = {
  success: (title: string, message?: string) => push({ kind: 'success', title, message }),
  error: (title: string, message?: string, hint?: string) => push({ kind: 'error', title, message, hint }),
  info: (title: string, message?: string) => push({ kind: 'info', title, message }),
};

function push(t: Omit<Toast, 'id'>) {
  const item: Toast = { ...t, id: ++toastId };
  toasts = [...toasts, item].slice(-4);
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== item.id); emit(); }, t.kind === 'error' ? 9000 : 4200);
}

export const Toaster: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l: Listener = (t) => setItems(t);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={clsx('animate-in card pointer-events-auto flex items-start gap-2.5 border-l-2 px-3 py-2.5 shadow-xl',
          t.kind === 'success' ? 'border-l-good' : t.kind === 'error' ? 'border-l-bad' : 'border-l-info')}>
          <Icon name={t.kind === 'success' ? 'CheckCircle2' : t.kind === 'error' ? 'AlertTriangle' : 'Info'}
            className={t.kind === 'success' ? 'text-good' : t.kind === 'error' ? 'text-bad' : 'text-info'} size={16} />
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-ink">{t.title}</div>
            {t.message && <div className="mt-0.5 break-words text-[11.5px] text-dim">{t.message}</div>}
            {t.hint && <div className="mt-1 text-[11px] leading-snug text-faint">{t.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export const CopyButton: React.FC<{ value: string; label?: string; className?: string }> = ({ value, label, className }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={clsx('btn btn-sm btn-ghost', className)}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
      }}
      title="Copy"
    >
      <Icon name={copied ? 'Check' : 'Copy'} size={12} />
      {label}
    </button>
  );
};

export const useDebounced = <T,>(value: T, delay = 250): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
};

export const useInterval = (fn: () => void, ms: number | null) => {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
};

/** Skeleton rows for tables while loading. */
export const TableSkeleton: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 6 }) => (
  <div className="space-y-1.5 p-3">
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex gap-3">
        {Array.from({ length: cols }).map((__, c) => (
          <div key={c} className="skeleton h-5" style={{ width: c === 0 ? '18%' : `${Math.max(8, 60 / cols)}%` }} />
        ))}
      </div>
    ))}
  </div>
);

export const useToggle = (initial = false): [boolean, () => void, (v: boolean) => void] => {
  const [value, setValue] = useState(initial);
  return [value, () => setValue((v) => !v), setValue];
};

export const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const parts = useMemo(() => {
    if (!query.trim()) return [text];
    const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
    if (idx < 0) return [text];
    return [text.slice(0, idx), text.slice(idx, idx + query.trim().length), text.slice(idx + query.trim().length)];
  }, [text, query]);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts[0]}<mark className="rounded bg-brand/25 px-0.5 text-ink">{parts[1]}</mark>{parts[2]}</>;
};
