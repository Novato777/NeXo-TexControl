import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES, DEFAULT_CUSTOMER_TAGS, formatCOP, formatDate, type CustomerType } from '@nexo/shared';
import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { Card, FilterBar, PageHeader, Segmented } from '@/components/ui/Layout';
import { SearchInput } from '@/components/ui/Pickers';
import { DataTable } from '@/components/ui/Table';
import { qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Customer } from '@/lib/types';
import { CustomerFormModal } from './CustomerForm';

export default function CustomersPage() {
  const { can, money } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState('');
  const [tag, setTag] = useState('');
  const [withBalance, setWithBalance] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useApi<Customer[]>(`/customers${qs({ q: dq, type, tag, withBalance })}`);
  return (
    <div>
      <PageHeader
        title="Clientes"
        actions={can('cliente.editar') ? <Button icon={UserPlus} onClick={() => setCreating(true)}>Agregar cliente</Button> : null}
      />
      <Card padded={false}>
        <FilterBar
          search={<SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, documento o teléfono" />}
          quick={money ? <Segmented label="Mostrar" value={withBalance ? 'deben' : 'todos'} onChange={(v) => setWithBalance(v === 'deben')} options={[{ value: 'todos', label: 'Todos' }, { value: 'deben', label: 'Los que deben' }]} /> : null}
          activeCount={[type, tag].filter(Boolean).length}
        >
          <Select className="w-auto" aria-label="Tipo de cliente" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos los tipos</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select className="w-auto" aria-label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Cualquier etiqueta</option>
            {DEFAULT_CUSTOMER_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </FilterBar>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <LoadingBlock />
        ) : (
          <>
          {(data?.length ?? 0) >= 500 ? <p className="border-b border-line bg-warn-50 px-4 py-2 text-[13.5px] text-warn-700">Mostrando los primeros 500 clientes. Usa la búsqueda para encontrar a los demás.</p> : null}
          <DataTable
            rows={data ?? []}
            rowKey={(c) => c.id}
            onRowClick={(c) => nav(`/clientes/${c.id}`)}
            pageSize={20}
            empty={
              <EmptyState
                title={q ? `No encontramos clientes con “${q}”` : 'Todavía no hay clientes'}
                action={can('cliente.editar') ? <Button icon={UserPlus} onClick={() => setCreating(true)}>Agregar cliente</Button> : undefined}
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Cliente',
                render: (c) => (
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-[12.5px] text-muted">
                      {CUSTOMER_TYPE_LABELS[c.type as CustomerType]}
                      {c.document ? ` · ${c.document}` : ''}
                    </p>
                  </div>
                ),
                sortValue: (c) => c.name,
              },
              { key: 'phone', header: 'Teléfono', render: (c) => c.phone ?? '—', hideOnMobile: true },
              { key: 'last', header: 'Última compra', render: (c) => formatDate(c.lastPurchase), sortValue: (c) => c.lastPurchase, hideOnMobile: true },
              ...(money
                ? [
                    { key: 'bal', header: 'Saldo', align: 'right' as const, render: (c: Customer) => (c.balance ? <span className="num font-semibold text-warn-700">{formatCOP(c.balance)}</span> : <span className="text-muted">—</span>), sortValue: (c: Customer) => c.balance },
                  ]
                : []),
            ]}
          />
          </>
        )}
      </Card>
      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => nav(`/clientes/${c.id}`)} />
    </div>
  );
}
