import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  hideOnMobile?: boolean;
}

/** Tabla con orden por columna, paginación y fila clicable. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  pageSize = 15,
  empty,
  initialSort,
  footer,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string | number;
  onRowClick?: (r: T) => void;
  pageSize?: number;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  footer?: ReactNode;
  caption?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows.length]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [rows, sort, columns]);

  if (!rows.length && empty) return <>{empty}</>;
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table-base">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} className={`${align(c.align)} ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortValue ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }))}
                      >
                        {c.header}
                        {active ? sort!.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={rowKey(r)}
                className={onRowClick ? 'row-link' : ''}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${align(c.align)} ${c.className ?? ''} ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[14px] text-muted">
          <span>
            Mostrando {page * pageSize + 1}–{Math.min(sorted.length, (page + 1) * pageSize)} de {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button className="inline-flex h-9 items-center gap-1 rounded-lg px-3 font-semibold text-petrol-700 hover:bg-petrol-50 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <span className="px-2">
              Página {page + 1} de {pages}
            </span>
            <button className="inline-flex h-9 items-center gap-1 rounded-lg px-3 font-semibold text-petrol-700 hover:bg-petrol-50 disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
