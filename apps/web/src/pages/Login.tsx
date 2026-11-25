import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@nexo/shared';
import { Factory, HandCoins, Boxes, LogIn, ShieldCheck, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocumentTitle } from '@/lib/hooks';

const ROLE_ICONS: Record<Role, LucideIcon> = { admin: ShieldCheck, ventas: ShoppingBag, produccion: Factory, finanzas: HandCoins, inventario: Boxes };

export function LoginPage() {
  useDocumentTitle('Ingresar');
  const { login, demoLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ enabled: boolean; password?: string; accounts: Array<{ name: string; email: string; role: Role }> } | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api
        .get<typeof demo>('/auth/demo-accounts')
        .then((d) => {
          setPreparing(false);
          setDemo(d);
        })
        .catch((e: ApiError) => {
          if (e.status === 503 && !stop) {
            setPreparing(true);
            setTimeout(load, 3000);
          }
        });
    load();
    return () => {
      stop = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('form');
    try {
      await login(email, password);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const quick = async (role: Role) => {
    setError(null);
    setBusy(role);
    try {
      await demoLogin(role);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <section className="relative flex flex-col justify-between overflow-hidden bg-petrol-700 px-8 py-10 text-white lg:w-[44%] lg:px-14 lg:py-14">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-lg ring-2 ring-white/20" />
          <span className="text-[19px] font-extrabold">TexControl</span>
        </div>
        <div className="my-10 max-w-md">
          <h1 className="text-[34px] font-extrabold leading-[1.1] text-white lg:text-[42px]">Del pedido a la entrega, sin perder una sola puntada.</h1>
          <p className="mt-4 text-[16.5px] leading-relaxed text-petrol-100">
            Pedidos, producción, inventario y caja de tu taller de uniformes en un solo lugar, con pantallas pensadas para usarse sin capacitación.
          </p>
        </div>
        <div className="stitch-x w-40 text-teal-500/80" aria-hidden />
        <svg className="pointer-events-none absolute -right-16 -bottom-10 h-72 w-72 text-white/[0.06]" viewBox="0 0 100 100" aria-hidden>
          <path d="M28 30l12-9h20l12 9-6 10h-6v40H40V40h-6z" fill="currentColor" />
        </svg>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <h2 className="text-[26px] font-extrabold">Ingresar</h2>
          <p className="mt-1 text-muted">Escribe tu correo y contraseña.</p>
          {preparing ? (
            <div className="mt-4">
              <Notice tone="warn" title="Estamos preparando la demo">
                La primera vez se cargan los datos de ejemplo. Esto toma uno o dos minutos; la página se actualiza sola.
              </Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <Notice tone="risk" title="No pudimos ingresar">
                {error}
              </Notice>
            </div>
          ) : null}
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Correo" required htmlFor="email">
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            </Field>
            <Field label="Contraseña" required htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" size="lg" icon={LogIn} className="w-full" loading={busy === 'form'}>
              Ingresar
            </Button>
          </form>

          {demo?.enabled ? (
            <div className="mt-9">
              <div className="mb-3 flex items-center gap-3">
                <span className="stitch-x flex-1 text-line-strong" aria-hidden />
                <span className="text-[14px] font-semibold text-muted">o entra directo como</span>
                <span className="stitch-x flex-1 text-line-strong" aria-hidden />
              </div>
              <div className="grid gap-2">
                {demo.accounts.map((a) => {
                  const Icon = ROLE_ICONS[a.role];
                  return (
                    <button
                      key={a.role}
                      onClick={() => quick(a.role)}
                      disabled={!!busy}
                      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-petrol-200 hover:bg-petrol-50 disabled:opacity-60"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-petrol-50 text-petrol-600">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="flex-1">
                        <span className="block font-bold text-ink">
                          {ROLE_LABELS[a.role]} <span className="font-normal text-muted">· {a.name}</span>
                        </span>
                        <span className="block text-[13.5px] leading-snug text-muted">{ROLE_DESCRIPTIONS[a.role]}</span>
                      </span>
                      {busy === a.role ? <span className="text-[13px] text-muted">Entrando…</span> : null}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[13px] text-muted">
                Cuentas de demostración. Contraseña para todas: <strong className="text-ink">{demo.password}</strong>
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
