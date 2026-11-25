import { formatCOP, formatQty, PRODUCT_TYPE_LABELS, PRODUCT_TYPES, type ProductType } from '@nexo/shared';
import { Download, PackagePlus, Shirt } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonLink, btnClass } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { Card, FilterBar, PageHeader } from '@/components/ui/Layout';
import { InventorySectionTabs } from '../inventory/InventoryPage';
import { SearchInput } from '@/components/ui/Pickers';
import { DataTable } from '@/components/ui/Table';
import { downloadUrl, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Settings } from '@/lib/types';

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  type: ProductType;
  category: string;
  unit: string;
  price: number;
  cost: number;
  active: boolean;
  variantsCount: number;
  sizes: string[];
  colors: string[];
  stock: number;
  available: number;
  lowCount: number;
  minPrice: number;
  maxPrice: number;
  margin: number;
  isStock: boolean;
}

export default function ProductsPage() {
  const { can, money } = useAuth();
  const nav = useNavigate();
  const { data: settings } = useApi<Settings>('/settings');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('active');
  const [low, setLow] = useState(false);
  const { data, isLoading, error, refetch } = useApi<ProductRow[]>(`/products${qs({ q: dq, type, category, status, lowStock: low })}`);
  return (
    <div>
      <PageHeader
        title="Inventario"
        actions={
          <>
            <a href={downloadUrl('/products/export.csv')} className={btnClass('secondary')} download>
              <Download className="h-[18px] w-[18px]" aria-hidden /> Exportar
            </a>
            {can('producto.editar') ? (
              <ButtonLink to="/productos/nuevo" icon={PackagePlus}>
                Agregar producto
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <InventorySectionTabs active="productos" />
      <Card padded={false}>
        <FilterBar search={<SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, código o categoría" />} activeCount={[type, category, status !== 'active' ? status : '', low ? '1' : ''].filter(Boolean).length}>
          <Select className="w-auto" aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos los tipos</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select className="w-auto" aria-label="Categoría" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas las categorías</option>
            {settings?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select className="w-auto" aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Activos</option>
            <option value="archived">Archivados</option>
            <option value="all">Todos</option>
          </Select>
          <label className="flex h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[var(--radius-field)] border border-line-strong px-3 font-medium">
            <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} className="h-4.5 w-4.5 accent-[var(--color-petrol-600)]" />
            Solo bajo stock
          </label>
        </FilterBar>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <LoadingBlock />
        ) : (
          <DataTable
            rows={data ?? []}
            rowKey={(p) => p.id}
            onRowClick={(p) => nav(`/productos/${p.id}`)}
            pageSize={20}
            empty={
              <EmptyState
                title={q || type || category || low ? 'No hay productos con estos filtros' : 'Todavía no hay productos'}
                action={can('producto.editar') ? <ButtonLink to="/productos/nuevo" icon={PackagePlus}>Agregar el primer producto</ButtonLink> : undefined}
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Producto',
                render: (p) => (
                  <div>
                    <p className="font-semibold">
                      {p.name} {!p.active ? <Badge tone="neutral">Archivado</Badge> : null}
                    </p>
                    <p className="text-[12.5px] text-muted">
                      {p.sku} · {p.category}
                    </p>
                  </div>
                ),
                sortValue: (p) => p.name,
              },
              {
                key: 'var',
                header: 'Tallas / colores',
                render: (p) => (
                  <span className="text-[13.5px] text-ink-soft">
                    {p.sizes.length ? `${p.sizes.length} tallas` : 'Única'}
                    {p.colors.length ? ` · ${p.colors.slice(0, 3).join(', ')}${p.colors.length > 3 ? '…' : ''}` : ''}
                  </span>
                ),
                hideOnMobile: true,
              },
              ...(money
                ? [
                    {
                      key: 'price',
                      header: 'Precio',
                      align: 'right' as const,
                      render: (p: ProductRow) => (p.type === 'materia_prima' || p.type === 'insumo' ? <span className="text-muted">—</span> : <span className="num">{p.minPrice === p.maxPrice ? formatCOP(p.price) : `${formatCOP(p.minPrice)} – ${formatCOP(p.maxPrice)}`}</span>),
                      sortValue: (p: ProductRow) => p.price,
                    },
                  ]
                : []),
              {
                key: 'stock',
                header: 'Disponible',
                align: 'right',
                render: (p) =>
                  p.isStock ? (
                    <span className="num">
                      {formatQty(p.available)} <span className="text-[12px] text-muted">{p.unit}</span>
                      {p.lowCount ? <span className="block text-[12.5px] font-semibold text-warn-700">{p.lowCount} bajo mínimo</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted">No aplica</span>
                  ),
                sortValue: (p) => p.available,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
