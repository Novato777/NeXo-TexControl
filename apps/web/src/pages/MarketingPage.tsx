import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, CHANNEL_LABELS, CHANNELS, formatDate, SEGMENT_LABELS, SEGMENTS, todayISO, type CampaignStatus, type Channel, type Segment } from '@nexo/shared';
import { Copy, ExternalLink, FileText, Film, Image, Megaphone, Pencil, Plus, Send, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, Notice, Tape } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, Tabs } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Overlay';
import { CampaignBadge } from '@/components/ui/Status';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useToast } from '@/lib/toast';

interface Campaign {
  id: number;
  name: string;
  objective: string | null;
  segment: Segment;
  channel: Channel;
  date: string;
  message: string;
  status: CampaignStatus;
  checklist: Array<{ text: string; done: boolean }>;
}
type Tab = 'campanas' | 'segmentos' | 'plantillas' | 'biblioteca';

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('campanas');
  return (
    <div>
      <PageHeader
        title="Marketing"
        icon={Megaphone}
        description="Los mensajes se copian o se abren en WhatsApp; no se envían solos."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'campanas', label: 'Campañas' },
          { value: 'segmentos', label: 'Grupos de clientes' },
          { value: 'plantillas', label: 'Plantillas de mensajes' },
          { value: 'biblioteca', label: 'Biblioteca de contenido' },
        ]}
      />
      {tab === 'campanas' ? <Campaigns /> : tab === 'segmentos' ? <Segments /> : tab === 'plantillas' ? <Templates /> : <Library />}
    </div>
  );
}

function Campaigns() {
  const { data, isLoading, error, refetch } = useApi<Campaign[]>('/marketing/campaigns');
  const [edit, setEdit] = useState<Campaign | 'new' | null>(null);
  const [send, setSend] = useState<Campaign | null>(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={Plus} onClick={() => setEdit('new')}>
          Crear campaña
        </Button>
      </div>
      {data.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((c) => {
            const done = c.checklist.filter((x) => x.done).length;
            return (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[17px] font-bold">{c.name}</h3>
                    {c.objective ? <p className="text-[14px] text-muted">{c.objective}</p> : null}
                  </div>
                  <CampaignBadge status={c.status} />
                </div>
                <p className="mt-3 text-[14px] text-ink-soft">
                  {SEGMENT_LABELS[c.segment]} · {CHANNEL_LABELS[c.channel]} · {formatDate(c.date)}
                </p>
                <p className="mt-3 line-clamp-3 rounded-lg bg-linen px-3 py-2 text-[14px] italic text-ink-soft">“{c.message}”</p>
                {c.checklist.length ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[13px] text-muted">
                      Lista de tareas: {done} de {c.checklist.length}
                    </p>
                    <Tape value={(done / c.checklist.length) * 100} tone="teal" />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEdit(c)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="soft" icon={Send} onClick={() => setSend(c)}>
                    Preparar envío
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState title="Todavía no hay campañas" action={<Button icon={Plus} onClick={() => setEdit('new')}>Crear la primera campaña</Button>} />
        </Card>
      )}
      <CampaignModal open={!!edit} onClose={() => setEdit(null)} campaign={edit === 'new' ? null : edit} />
      {send ? <SendModal campaign={send} onClose={() => setSend(null)} /> : null}
    </>
  );
}

function CampaignModal({ open, onClose, campaign }: { open: boolean; onClose: () => void; campaign: Campaign | null }) {
  const blank = { name: '', objective: '', segment: 'frecuentes' as Segment, channel: 'whatsapp' as Channel, date: todayISO(), message: '', status: 'borrador' as CampaignStatus, checklist: [] as Campaign['checklist'] };
  const [f, setF] = useState(blank);
  const [task, setTask] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF(campaign ? { ...campaign, objective: campaign.objective ?? '' } : blank);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign]);
  const save = useAction(() => (campaign ? api.put(`/marketing/campaigns/${campaign.id}`, f) : api.post('/marketing/campaigns', f)), { success: 'Campaña guardada', silentError: true, onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={campaign ? 'Editar campaña' : 'Crear campaña'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}>
            Guardar campaña
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {errors._ ? <p className="rounded-lg bg-risk-50 px-3 py-2 font-semibold text-risk-700 sm:col-span-2">{errors._}</p> : null}
        <Field label="Nombre" required error={errors.name} htmlFor="cm-name" className="sm:col-span-2">
          <Input id="cm-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Objetivo" htmlFor="cm-obj" className="sm:col-span-2">
          <Input id="cm-obj" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="Ej: separar pedidos de colegios antes de diciembre" />
        </Field>
        <Field label="¿A quién va dirigida?" required htmlFor="cm-seg">
          <Select id="cm-seg" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value as Segment })}>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Canal" required htmlFor="cm-ch">
          <Select id="cm-ch" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Channel })}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha" required htmlFor="cm-date">
          <Input id="cm-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Estado" required htmlFor="cm-st">
          <Select id="cm-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CampaignStatus })}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CAMPAIGN_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mensaje" required error={errors.message} htmlFor="cm-msg" className="sm:col-span-2">
          <Textarea id="cm-msg" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="min-h-[110px]" invalid={!!errors.message} />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[14px] font-semibold text-ink-soft">Lista de tareas</p>
          <ul className="mb-2 space-y-1">
            {f.checklist.map((t, i) => (
              <li key={i}>
                <Checkbox checked={t.done} onChange={(v) => setF({ ...f, checklist: f.checklist.map((x, j) => (j === i ? { ...x, done: v } : x)) })} label={t.text} />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Ej: preparar fotos del catálogo" aria-label="Nueva tarea" />
            <Button
              variant="soft"
              onClick={() => {
                if (task.trim()) {
                  setF({ ...f, checklist: [...f.checklist, { text: task.trim(), done: false }] });
                  setTask('');
                }
              }}
            >
              Agregar tarea
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SendModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const toast = useToast();
  const { data } = useApi<Array<{ id: number; name: string; phone: string | null }>>(`/marketing/segments/${campaign.segment}`);
  const [opened, setOpened] = useState<number[]>([]);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Preparar envío · ${campaign.name}`}
      description={`${SEGMENT_LABELS[campaign.segment]} (solo clientes que aceptan recibir mensajes).`}
      footer={
        <Button
          variant="secondary"
          icon={Copy}
          onClick={async () => {
            await navigator.clipboard.writeText(campaign.message).catch(() => null);
            toast.success('Mensaje copiado');
          }}
        >
          Copiar mensaje
        </Button>
      }
    >
      <Notice tone="warn" title="Envío manual (demo)">
        Toca “Abrir WhatsApp” en cada cliente: se abre el chat con el mensaje listo y tú decides enviarlo. La integración oficial con WhatsApp Business queda para una fase futura.
      </Notice>
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {(data ?? []).map((c) => {
          const phone = (c.phone ?? '').replace(/\D/g, '');
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1">
                <span className="block font-semibold">{c.name}</span>
                <span className="text-[13px] text-muted">{c.phone ?? 'Sin teléfono'}</span>
              </span>
              {opened.includes(c.id) ? <span className="text-[13px] font-semibold text-ok-700">Abierto</span> : null}
              {phone ? (
                <a
                  href={`https://wa.me/57${phone.slice(-10)}?text=${encodeURIComponent(campaign.message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpened((o) => [...o, c.id])}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-btn)] bg-petrol-50 px-3 text-[14px] font-semibold text-petrol-700 hover:bg-petrol-100"
                >
                  <ExternalLink className="h-4 w-4" /> Abrir WhatsApp
                </a>
              ) : null}
            </li>
          );
        })}
        {data && !data.length ? <li className="px-4 py-4 text-muted">No hay clientes en este grupo.</li> : null}
      </ul>
    </Modal>
  );
}

function Segments() {
  const { data } = useApi<{ segments: Array<{ key: Segment; count: number }>; withoutConsent: number }>('/marketing/segments');
  const [open, setOpen] = useState<Segment | null>(null);
  const list = useApi<Array<{ id: number; name: string; phone: string | null; purchases: number; lastPurchase: string | null }>>(open ? `/marketing/segments/${open}` : null);
  if (!data) return <LoadingBlock />;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.segments.map((s) => (
          <button key={s.key} onClick={() => setOpen(s.key)} className="card p-5 text-left transition-colors hover:border-petrol-200">
            <Users className="mb-2 h-6 w-6 text-petrol-500" aria-hidden />
            <p className="font-bold">{SEGMENT_LABELS[s.key]}</p>
            <p className="num mt-1 text-[26px] font-extrabold">{s.count}</p>
            <p className="text-[13px] text-muted">clientes · ver lista</p>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[14px] text-muted">{data.withoutConsent} cliente(s) no aceptan mensajes y no aparecen en ningún grupo.</p>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? SEGMENT_LABELS[open] : ''} size="lg">
        <ul className="divide-y divide-line">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="flex justify-between gap-3 py-2.5">
              <span className="font-semibold">{c.name}</span>
              <span className="text-[13.5px] text-muted">
                {c.purchases} compras · última {formatDate(c.lastPurchase)}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function Templates() {
  const toast = useToast();
  const { data } = useApi<Array<{ id: number; key: string; name: string; body: string }>>('/marketing/templates');
  const [edit, setEdit] = useState<{ id: number; name: string; body: string } | null>(null);
  const save = useAction((b: { body: string }) => api.put(`/marketing/templates/${edit!.id}`, b), { success: 'Plantilla guardada', onSuccess: () => setEdit(null) });
  if (!data) return <LoadingBlock />;
  return (
    <>
      <p className="mb-4 text-[14.5px] text-muted">
        Las palabras entre llaves se reemplazan solas: <code>{'{cliente}'}</code>, <code>{'{pedido}'}</code>, <code>{'{total}'}</code>, <code>{'{saldo}'}</code>, <code>{'{fecha}'}</code>, <code>{'{empresa}'}</code>. Estas plantillas se usan en “Mensaje para el cliente” dentro de cada pedido.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((t) => (
          <Card key={t.id} title={t.name} actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(t)}>Editar</Button>}>
            <p className="text-[14.5px] text-ink-soft">{t.body}</p>
            <button
              className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-petrol-700 hover:underline"
              onClick={async () => {
                await navigator.clipboard.writeText(t.body).catch(() => null);
                toast.success('Plantilla copiada');
              }}
            >
              <Copy className="h-4 w-4" /> Copiar
            </button>
          </Card>
        ))}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={`Editar plantilla · ${edit?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate({ body: edit!.body })}>
              Guardar plantilla
            </Button>
          </>
        }
      >
        <Textarea value={edit?.body ?? ''} onChange={(e) => setEdit((x) => (x ? { ...x, body: e.target.value } : x))} className="min-h-[150px]" aria-label="Texto de la plantilla" />
      </Modal>
    </>
  );
}

function Library() {
  const { data } = useApi<Array<{ id: number; name: string; kind: string; description: string | null; url: string | null; createdAt: string }>>('/marketing/assets');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'imagen', description: '', url: '' });
  const save = useAction(() => api.post('/marketing/assets', f), {
    success: 'Contenido agregado',
    onSuccess: () => {
      setAdding(false);
      setF({ name: '', kind: 'imagen', description: '', url: '' });
    },
  });
  if (!data) return <LoadingBlock />;
  const icon = (k: string) => (k === 'video' ? Film : k === 'documento' ? FileText : Image);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Agregar contenido
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((a) => {
          const Icon = icon(a.kind);
          return (
            <Card key={a.id}>
              <div className="stitch-border mb-3 flex h-28 items-center justify-center rounded-xl bg-linen text-petrol-500">
                <Icon className="h-10 w-10" aria-hidden />
              </div>
              <p className="font-bold">{a.name}</p>
              <p className="text-[14px] text-muted">{a.description}</p>
              {a.url && /^https?:\/\//i.test(a.url) ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[14px] font-semibold text-petrol-700 hover:underline">
                  <ExternalLink className="h-4 w-4" /> Abrir enlace
                </a>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Agregar contenido"
        description="En la demo se guarda el nombre y un enlace (por ejemplo, de Google Drive). La carga de archivos queda para la versión completa."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>
              Guardar contenido
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre" required htmlFor="as-n">
            <Input id="as-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Tipo" required htmlFor="as-k">
            <Select id="as-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="imagen">Imagen</option>
              <option value="video">Video</option>
              <option value="documento">Documento</option>
            </Select>
          </Field>
          <Field label="Descripción" htmlFor="as-d">
            <Textarea id="as-d" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label="Enlace" htmlFor="as-u">
            <Input id="as-u" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
