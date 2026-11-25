import { formatCOP, marginPct, PRODUCT_TYPE_HELP, PRODUCT_TYPE_LABELS, PRODUCT_TYPES, STOCK_PRODUCT_TYPES, type ProductType } from '@nexo/shared';
import { Boxes, Factory, Save, Scissors, Shirt, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { HelpTip, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Checkbox, ChoiceCards, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader } from '@/components/ui/Layout';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Settings } from '@/lib/types';

interface VariantDraft {
  id?: number;
  size: string | null;
  color: string | null;
  price: number | null;
  minStock: number | null;
  initialStock: number;
  stock?: number;
}
interface ProductDetail {
  product: { id: number; name: string; sku: string; type: ProductType; category: string; description: string | null; unit: string; price: number; cost: number; minStock: number; location: string | null; customizable: boolean };
  variants: Array<{ id: number; size: string | null; color: string | null; price: number | null; minStock: number | null; stock: number }>;
}

const TYPE_ICONS = { terminado: Shirt, materia_prima: Scissors, insumo: Boxes, servicio: Wrench } as const;

export default function ProductForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { data: settings } = useApi<Settings>('/settings');
  const existing = useApi<ProductDetail>(editing ? `/products/${id}` : null);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [type, setType] = useState<ProductType>('terminado');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('unidad');
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [minStock, setMinStock] = useState(5);
  const [location, setLocation] = useState('');
  const [customizable, setCustomizable] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const p = d.product;
    setName(p.name);
    setSku(p.sku);
    setType(p.type);
    setCategory(p.category);
    setDescription(p.description ?? '');
    setUnit(p.unit);
    setPrice(p.price);
    setCost(p.cost);
    setMinStock(Number(p.minStock));
    setLocation(p.location ?? '');
    setCustomizable(p.customizable);
    setSizes([...new Set(d.variants.map((v) => v.size).filter(Boolean) as string[])]);
    setColors([...new Set(d.variants.map((v) => v.color).filter(Boolean) as string[])]);
    setVariants(d.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, price: v.price, minStock: v.minStock != null ? Number(v.minStock) : null, initialStock: 0, stock: v.stock })));
  }, [existing.data]);

  useEffect(() => {
    if (!editing && settings && !category) setCategory(settings.categories[0]);
  }, [settings, editing, category]);

  // Genera las combinaciones talla × color conservando lo que ya existe.
  useEffect(() => {
    const sz = sizes.length ? sizes : [null];
    const cl = colors.length ? colors : [null];
    setVariants((prev) => {
      const next: VariantDraft[] = [];
      for (const c of cl)
        for (const s of sz) {
          const found = prev.find((v) => (v.size ?? null) === s && (v.color ?? null) === c);
          next.push(found ?? { size: s, color: c, price: null, minStock: null, initialStock: 0 });
        }
      // Variantes existentes que el usuario "quitó": se conservan (no se borra historial).
      for (const v of prev) if (v.id && !next.includes(v)) next.push(v);
      return next;
    });
  }, [sizes, colors]);

  const isStock = STOCK_PRODUCT_TYPES.includes(type);
  const sells = type === 'terminado' || type === 'servicio';
  const margin = useMemo(() => marginPct(price, cost), [price, cost]);

  const save = useAction(
    () => {
      const body = {
        name,
        sku: sku || null,
        type,
        category,
        description: description || null,
        unit,
        price: sells ? price : 0,
        cost,
        minStock: isStock ? minStock : 0,
        location: location || null,
        customizable,
        variants: variants.map((v) => ({ id: v.id, size: v.size, color: v.color, price: v.price, minStock: v.minStock, initialStock: v.id ? null : v.initialStock })),
      };
      return editing ? api.put<{ ok: true }>(`/products/${id}`, body).then(() => ({ id: Number(id) })) : api.post<{ id: number }>('/products', body);
    },
    {
      success: editing ? 'Producto actualizado' : 'Producto creado',
      silentError: true,
      onSuccess: (r) => nav(`/productos/${r.id}`),
    },
  );
  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Escribe el nombre del producto.';
    if (sells && type === 'terminado' && price <= 0) e.price = 'Escribe el precio de venta.';
    if (Object.keys(e).length) {
      setErrors(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setErrors({});
    save.mutate(undefined, { onError: (err: ApiError) => setErrors({ ...(err.fields ?? {}), submit: err.message }) });
  };

  if (editing && existing.isLoading) return <LoadingBlock rows={8} />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={editing ? `Editar ${name}` : 'Agregar producto'}
        description="Completa las secciones en orden. Los campos con * son obligatorios."
        back={{ to: editing ? `/productos/${id}` : '/productos', label: editing ? 'Volver al producto' : 'Productos' }}
      />
      <div className="space-y-6">
        <Card title="1. ¿Qué es?">
          <div className="space-y-5">
            {!editing ? (
              <ChoiceCards
                name="ptype"
                columns={4}
                value={type}
                onChange={(t) => {
                  setType(t);
                  if (t === 'materia_prima') setUnit('metro');
                  if (t !== 'materia_prima' && unit === 'metro') setUnit('unidad');
                }}
                options={PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABELS[t], description: PRODUCT_TYPE_HELP[t], icon: TYPE_ICONS[t] }))}
              />
            ) : (
              <p className="text-[14.5px]">
                Tipo: <strong>{PRODUCT_TYPE_LABELS[type]}</strong> <span className="text-muted">(no se puede cambiar si ya tiene movimientos)</span>
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" required error={errors.name} htmlFor="p-name" className="sm:col-span-2">
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Camisa escolar manga larga" invalid={!!errors.name} />
              </Field>
              <Field label="Categoría" required htmlFor="p-cat">
                <Select id="p-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {settings?.categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Código (SKU)" hint="Déjalo vacío y el sistema crea uno." error={errors.sku} htmlFor="p-sku">
                <Input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="Automático" invalid={!!errors.sku} />
              </Field>
              <Field label="Descripción" htmlFor="p-desc" className="sm:col-span-2">
                <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            {type === 'terminado' ? <Checkbox checked={customizable} onChange={setCustomizable} label="Se puede personalizar" description="Acepta logo, bordado, estampado, nombres o medidas especiales." /> : null}
          </div>
        </Card>

        <Card title="2. Precio y costo">
          <div className="grid gap-4 sm:grid-cols-3">
            {sells ? (
              <Field label="Precio de venta" required={type === 'terminado'} error={errors.price} htmlFor="p-price">
                <MoneyInput id="p-price" value={price} onChange={setPrice} invalid={!!errors.price} />
              </Field>
            ) : null}
            <Field
              label={isStock && !sells ? 'Costo por unidad de medida' : 'Costo estimado'}
              htmlFor="p-cost"
              hint={type === 'terminado' ? 'Lo que cuesta fabricarlo (material + mano de obra).' : undefined}
            >
              <MoneyInput id="p-cost" value={cost} onChange={setCost} />
            </Field>
            <Field label="Unidad de medida" required htmlFor="p-unit">
              <Select id="p-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {settings?.units.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
          </div>
          {sells && price > 0 ? (
            <p className={`mt-3 text-[14.5px] font-semibold ${margin < 20 ? 'text-warn-700' : 'text-ok-700'}`}>
              Margen estimado: {margin}% (ganancia de {formatCOP(price - cost)} por {unit})
              <HelpTip>El margen es la parte del precio que queda después de pagar el costo. Por debajo de 20% conviene revisar el precio.</HelpTip>
            </p>
          ) : null}
        </Card>

        {type !== 'servicio' ? (
          <Card title="3. Tallas y colores" subtitle="Toca las tallas y colores que maneja. El sistema crea cada combinación (variante).">
            <div className="space-y-5">
              <ChipPicker label="Tallas" options={settings?.sizes ?? []} values={sizes} onChange={setSizes} emptyHint="Sin tallas = talla única" />
              <ChipPicker label="Colores" options={settings?.colors ?? []} values={colors} onChange={setColors} emptyHint="Sin color" />
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Variante</th>
                      {sells ? <th>Precio diferente <span className="font-normal">(opcional)</span></th> : null}
                      {isStock ? <th>Mínimo propio <span className="font-normal">(opcional)</span></th> : null}
                      {isStock ? <th>{editing ? 'Existencias' : 'Existencias iniciales'}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={`${v.size}-${v.color}-${v.id ?? 'n'}`}>
                        <td className="font-semibold">
                          {v.size ? `Talla ${v.size}` : 'Única'}
                          {v.color ? ` · ${v.color}` : ''}
                          {v.id && !(sizes.includes(v.size ?? '') || !v.size) ? <span className="block text-[12px] font-normal text-muted">Ya existe; se conserva</span> : null}
                        </td>
                        {sells ? (
                          <td>
                            <MoneyInput value={v.price} onChange={(n) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, price: n || null } : x)))} placeholder={formatCOP(price)} aria-label="Precio de la variante" className="h-10 max-w-[160px]" />
                          </td>
                        ) : null}
                        {isStock ? (
                          <td>
                            <Input
                              inputMode="decimal"
                              className="num h-10 max-w-[110px] text-right"
                              placeholder={String(minStock)}
                              value={v.minStock ?? ''}
                              onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, minStock: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                              aria-label="Mínimo de la variante"
                            />
                          </td>
                        ) : null}
                        {isStock ? (
                          <td>
                            {v.id ? (
                              <span className="num text-muted">{v.stock} (se ajusta en Inventario)</span>
                            ) : (
                              <Input
                                inputMode="decimal"
                                className="num h-10 max-w-[110px] text-right"
                                value={v.initialStock || ''}
                                placeholder="0"
                                onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, initialStock: Number(e.target.value.replace(',', '.')) || 0 } : x)))}
                                aria-label="Existencias iniciales"
                              />
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        ) : null}

        {isStock ? (
          <Card title="4. Inventario">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Stock mínimo (${unit})`} hint="Cuando quede menos, el sistema te avisa." htmlFor="p-min">
                <Input id="p-min" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(Number(e.target.value.replace(',', '.')) || 0)} className="num" />
              </Field>
              <Field label="Ubicación en bodega" htmlFor="p-loc">
                <Input id="p-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej: Estante A, nivel 2" />
              </Field>
            </div>
            {type === 'terminado' ? (
              <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
                <Factory className="h-4 w-4" aria-hidden /> Después de guardar podrás registrar la receta de materiales para que producción calcule lo que necesita.
              </p>
            ) : null}
          </Card>
        ) : null}

        {errors.submit ? (
          <Notice tone="risk" title="No se pudo guardar">
            {errors.submit}
          </Notice>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => nav(-1)}>
            Cancelar
          </Button>
          <Button size="lg" icon={Save} loading={save.isPending} onClick={submit}>
            {editing ? 'Guardar cambios' : 'Guardar producto'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChipPicker({ label, options, values, onChange, emptyHint }: { label: string; options: string[]; values: string[]; onChange: (v: string[]) => void; emptyHint: string }) {
  const [custom, setCustom] = useState('');
  const all = [...options, ...values.filter((v) => !options.includes(v))];
  return (
    <div>
      <p className="mb-2 text-[14px] font-semibold text-ink-soft">
        {label} <span className="font-normal text-muted">· {values.length ? `${values.length} elegidas` : emptyHint}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {all.map((o) => {
          const on = values.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? values.filter((v) => v !== o) : [...values, o])}
              className={`min-w-11 rounded-lg border-2 px-3 py-1.5 text-[14.5px] font-semibold transition-colors ${on ? 'border-petrol-600 bg-petrol-600 text-white' : 'border-line bg-surface text-ink-soft hover:border-petrol-200'}`}
            >
              {o}
            </button>
          );
        })}
        <span className="inline-flex items-center gap-1">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Otra…" className="h-9 w-24" aria-label={`Agregar otra ${label.toLowerCase()}`} onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              e.preventDefault();
              onChange([...values, custom.trim()]);
              setCustom('');
            }
          }} />
        </span>
      </div>
    </div>
  );
}
