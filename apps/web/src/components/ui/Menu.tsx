import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

/** Menú "Más" para acciones secundarias: mantiene a la vista solo la acción principal. */
export function ActionMenu({ items, label = 'Más' }: { items: Array<{ label: string; icon: LucideIcon; onClick: () => void; danger?: boolean } | null | false>; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as Array<{ label: string; icon: LucideIcon; onClick: () => void; danger?: boolean }>;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  if (!list.length) return null;
  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" icon={MoreHorizontal} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        {label}
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[var(--shadow-pop)]">
          {list.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] font-medium ${it.danger ? 'text-risk-700 hover:bg-risk-50' : 'text-ink hover:bg-petrol-50'}`}
            >
              <it.icon className="h-[18px] w-[18px]" aria-hidden />
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
