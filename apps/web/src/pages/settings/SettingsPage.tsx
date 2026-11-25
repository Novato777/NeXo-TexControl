import {
  formatDateTime,
  MODULES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_MODULES,
  ROLES,
  type Module,
  type Role,
} from '@nexo/shared';
import { Building, Check, ListChecks, RotateCcw, Save, Settings as SettingsIcon, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, TagEditor, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, Tabs } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { SearchInput } from '@/components/ui/Pickers';
import { DataTable } from '@/components/ui/Table';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import type { Settings } from '@/lib/types';

type Tab = 'empresa' | 'catalogos' | 'usuarios' | 'auditoria' | 'demo';
const MODULE_LABELS: Record<Module, string> = {
  inicio: 'Inicio',
  pedidos: 'Pedidos y ventas',
  produccion: 'Producción',
  entregas: 'Entregas',
  inventario: 'Inventario',
  productos: 'Productos',
  clientes: 'Clientes',
  proveedores: 'Proveedores y compras',
  caja: 'Caja y gastos',
  cartera: 'Cartera',
  reportes: 'Reportes',
  analisis: 'Estimaciones',
  marketing: 'Marketing',
  configuracion: 'Configuración',
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('empresa');
  const { data: settings, isLoading } = useApi<Settings>('/settings');
  return (
    <div>
      <PageHeader title="Configuración" icon={SettingsIcon} description="Datos del negocio, listas, usuarios y permisos." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'empresa', label: 'Empresa', icon: Building },
          { value: 'catalogos', label: 'Listas y catálogos', icon: ListChecks },
          { value: 'usuarios', label: 'Usuarios y roles', icon: Users },
          { value: 'auditoria', label: 'Auditoría', icon: ShieldCheck },
          { value: 'demo', label: 'Datos de demostración', icon: RotateCcw },
        ]}
      />
      {isLoading || !settings ? (
        <LoadingBlock />
      ) : tab === 'empresa' ? (
        <Company settings={settings} />
      ) : tab === 'catalogos' ? (
        <Catalogs settings={settings} />
      ) : tab === 'usuarios' ? (
        <UsersTab />
      ) : tab === 'auditoria' ? (
        <AuditTab />
      ) : (
        <DemoTab />
      )}
    </div>
  );
}

function useSaveSettings() {
  return useAction((b: Settings) => api.put<Settings>('/settings', b), { success: 'Configuración guardada' });
}

function Company({ settings }: { settings: Settings }) {
  const [f, setF] = useState(settings);
  const save = useSaveSettings();
  const set = (k: keyof Settings, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Datos del negocio" subtitle="Aparecen en los comprobantes impresos.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre de la empresa" required htmlFor="s-n" className="sm:col-span-2">
            <Input id="s-n" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </Field>
          <Field label="NIT" htmlFor="s-nit">
            <Input id="s-nit" value={f.nit ?? ''} onChange={(e) => set('nit', e.target.value)} />
          </Field>
          <Field label="Teléfono" htmlFor="s-ph">
            <Input id="s-ph" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Correo" htmlFor="s-em">
            <Input id="s-em" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Ciudad" htmlFor="s-ci">
            <Input id="s-ci" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Dirección" htmlFor="s-ad" className="sm:col-span-2">
            <Input id="s-ad" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Texto al pie de los comprobantes" htmlFor="s-ft" className="sm:col-span-2">
            <Textarea id="s-ft" value={f.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button icon={Save} loading={save.isPending} onClick={() => save.mutate(f)}>
            Guardar datos
          </Button>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Moneda y zona horaria">
          <p className="text-[14.5px]">Pesos colombianos (COP), sin decimales.</p>
          <p className="text-[14.5px]">Hora de Colombia (Bogotá).</p>
        </Card>
        <Notice tone="warn" title="Impuestos y facturación electrónica">
          Quedan para una fase futura. Se deben definir con asesoría contable y legal (DIAN). Los comprobantes de esta demo no son facturas.
        </Notice>
      </div>
    </div>
  );
}

function Catalogs({ settings }: { settings: Settings }) {
  const [f, setF] = useState(settings);
  const save = useSaveSettings();
  const lists: Array<[keyof Settings, string, string]> = [
    ['sizes', 'Tallas', 'Ej: 18, 3XL'],
    ['colors', 'Colores', 'Ej: Beige'],
    ['categories', 'Categorías de productos', 'Ej: Uniforme de chef'],
    ['units', 'Unidades de medida', 'Ej: kilo'],
    ['expenseCategories', 'Categorías de gastos', 'Ej: Seguros'],
    ['productionStages', 'Etapas de producción (en orden)', 'Ej: Planchado'],
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {lists.map(([k, label, ph]) => (
          <Card key={k} title={label}>
            <TagEditor values={f[k] as string[]} onChange={(v) => setF((x) => ({ ...x, [k]: v }))} placeholder={ph} />
          </Card>
        ))}
        <Card title="Métodos de pago">
          <div className="space-y-1">
            {PAYMENT_METHODS.map((m) => (
              <Checkbox key={m} checked={f.paymentMethods.includes(m)} onChange={(on) => setF((x) => ({ ...x, paymentMethods: on ? [...x.paymentMethods, m] : x.paymentMethods.filter((y) => y !== m) }))} label={PAYMENT_METHOD_LABELS[m]} />
            ))}
          </div>
        </Card>
      </div>
      <div className="flex justify-end">
        <Button size="lg" icon={Save} loading={save.isPending} onClick={() => save.mutate(f)}>
          Guardar listas
        </Button>
      </div>
    </div>
  );
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}
function UsersTab() {
  const { user: me } = useAuth();
  const { data } = useApi<UserRow[]>('/users');
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  return (
    <div className="space-y-6">
      <Card title="Usuarios" actions={<Button size="sm" icon={UserPlus} onClick={() => setEdit('new')}>Agregar usuario</Button>} padded={false}>
        {data ? (
          <DataTable
            rows={data}
            rowKey={(u) => u.id}
            onRowClick={(u) => setEdit(u)}
            columns={[
              { key: 'n', header: 'Nombre', render: (u) => <span className="font-semibold">{u.name}{u.id === me?.id ? <span className="ml-2 text-[13px] font-normal text-muted">(tú)</span> : null}</span> },
              { key: 'e', header: 'Correo', render: (u) => u.email },
              { key: 'r', header: 'Rol', render: (u) => <Badge tone="petrol">{ROLE_LABELS[u.role]}</Badge> },
              { key: 'a', header: 'Estado', render: (u) => (u.active ? <Badge tone="ok">Activo</Badge> : <Badge tone="neutral">Desactivado</Badge>) },
              { key: 'l', header: 'Último ingreso', render: (u) => formatDateTime(u.lastLoginAt), hideOnMobile: true },
            ]}
          />
        ) : (
          <LoadingBlock />
        )}
      </Card>
      <Card title="Qué puede ver cada rol" subtitle="Roles fijos para la demo. Los roles personalizados quedan para la versión completa." padded={false}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Sección</th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m}>
                  <td className="font-medium">{MODULE_LABELS[m]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">
                      {ROLE_MODULES[r].includes(m) ? <Check className="mx-auto h-5 w-5 text-ok-500" aria-label="Sí" /> : <span className="text-line-strong" aria-label="No">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <UserModal open={!!edit} onClose={() => setEdit(null)} user={edit === 'new' ? null : edit} />
    </div>
  );
}

function UserModal({ open, onClose, user }: { open: boolean; onClose: () => void; user: UserRow | null }) {
  const [f, setF] = useState({ name: '', email: '', role: 'ventas' as Role, password: '', active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF(user ? { name: user.name, email: user.email, role: user.role, password: '', active: user.active } : { name: '', email: '', role: 'ventas', password: '', active: true });
      setErrors({});
    }
  }, [open, user]);
  const save = useAction(() => (user ? api.put(`/users/${user.id}`, { ...f, password: f.password || null }) : api.post('/users', f)), { success: 'Usuario guardado', silentError: true, onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Editar ${user.name}` : 'Agregar usuario'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}>
            Guardar usuario
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ ? <Notice tone="risk">{errors._}</Notice> : null}
        <Field label="Nombre" required error={errors.name} htmlFor="u-n">
          <Input id="u-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Correo (para ingresar)" required error={errors.email} htmlFor="u-e">
          <Input id="u-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} invalid={!!errors.email} />
        </Field>
        <Field label="Rol" required htmlFor="u-r" hint={ROLE_DESCRIPTIONS[f.role]}>
          <Select id="u-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? 'Nueva contraseña' : 'Contraseña'} required={!user} error={errors.password} hint={user ? 'Déjala vacía para no cambiarla.' : 'Mínimo 8 caracteres.'} htmlFor="u-p">
          <Input id="u-p" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} invalid={!!errors.password} />
        </Field>
        <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Usuario activo" description="Un usuario desactivado no puede ingresar." />
      </div>
    </Modal>
  );
}

function AuditTab() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [sensitive, setSensitive] = useState(true);
  const { data, isLoading } = useApi<Array<{ id: number; summary: string; action: string; createdAt: string; userName: string; sensitive: boolean; reference: string | null }>>(`/audit${qs({ q: dq, sensitive })}`);
  return (
    <Card padded={false} title="Registro de auditoría" subtitle="Quién hizo qué y cuándo. No se puede editar ni borrar.">
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar en la auditoría" className="flex-1" />
        <Checkbox checked={sensitive} onChange={setSensitive} label="Solo acciones sensibles" description="Precios, ajustes de stock, reversos, cierres de caja y cancelaciones." />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <DataTable
          rows={data ?? []}
          rowKey={(a) => a.id}
          pageSize={25}
          empty={<EmptyState title="No hay registros con esa búsqueda" />}
          columns={[
            { key: 'd', header: 'Fecha', render: (a) => <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span> },
            { key: 'u', header: 'Usuario', render: (a) => a.userName },
            { key: 's', header: 'Qué pasó', render: (a) => <span>{a.summary}{a.sensitive ? <Badge tone="warn" className="ml-2">Sensible</Badge> : null}</span> },
          ]}
        />
      )}
    </Card>
  );
}

function DemoTab() {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      await api.post('/demo/reset');
      toast.success('Datos de demostración restablecidos.');
      window.location.href = '/';
    } catch (e) {
      toast.error((e as ApiError).message);
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <Card title="Restablecer los datos de demostración">
      <p className="max-w-2xl text-ink-soft">
        Borra todo lo que se haya creado durante la demostración (pedidos, ventas, pagos, cajas, ajustes) y vuelve a cargar el negocio de ejemplo con un año de historia. Útil antes de una presentación.
      </p>
      <div className="mt-4 max-w-2xl">
        <Notice tone="warn">Toma uno o dos minutos. Mientras tanto, los demás usuarios verán un aviso de “preparando datos”.</Notice>
      </div>
      <Button variant="danger" icon={RotateCcw} className="mt-5" onClick={() => setConfirm(true)}>
        Restablecer datos de demostración
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title="¿Restablecer todos los datos?"
        confirmLabel={busy ? 'Restableciendo… (no cierres la página)' : 'Sí, borrar y volver a cargar'}
        tone="danger"
        loading={busy}
        onConfirm={reset}
        consequence="Se perderá todo lo registrado durante la demostración. Esta acción no se puede deshacer."
      />
    </Card>
  );
}
