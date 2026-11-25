import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Field, Textarea } from './Form';

/** Modal: solo para tareas cortas. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/45" style={{ animation: 'overlay-in .15s ease-out' }} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] ${w} -translate-x-1/2 -translate-y-1/2 flex-col rounded-[18px] bg-surface shadow-[var(--shadow-pop)] focus:outline-none`}
          style={{ animation: 'panel-in .18s ease-out' }}
        >
          <div className="flex items-start gap-4 border-b border-line px-6 py-4">
            <div className="flex-1">
              <Dialog.Title className="text-[19px] font-bold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[14.5px] text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-muted hover:bg-linen hover:text-ink" aria-label="Cerrar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex flex-col-reverse gap-2 border-t border-line bg-linen/60 px-6 py-3.5 sm:flex-row sm:justify-end rounded-b-[18px]">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Panel lateral para consultar detalle sin salir de la lista. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/35" style={{ animation: 'overlay-in .15s ease-out' }} />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-surface shadow-[var(--shadow-pop)] focus:outline-none" style={{ animation: 'drawer-in .2s ease-out' }}>
          <div className="flex items-center gap-4 border-b border-line px-6 py-4">
            <Dialog.Title className="flex-1 text-[19px] font-bold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close className="rounded-lg p-1.5 text-muted hover:bg-linen hover:text-ink" aria-label="Cerrar">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Confirmación de acciones que afectan dinero, stock, pedidos o producción.
 * Nombra la acción y explica la consecuencia. Opcionalmente exige un motivo.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequence,
  confirmLabel,
  tone = 'primary',
  loading,
  requireReason,
  reasonLabel = 'Motivo',
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'success';
  loading?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = requireReason && !reason.trim();
  return (
    <Modal
      open={open}
      onClose={() => {
        setReason('');
        setTouched(false);
        onClose();
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Volver sin cambios
          </Button>
          <Button
            variant={tone}
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (missing) return;
              onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {tone === 'danger' ? <AlertTriangle className="h-6 w-6 shrink-0 text-risk-500" aria-hidden /> : null}
        <div className="flex-1 space-y-4 text-ink-soft">
          <div>{consequence}</div>
          {children}
          {requireReason ? (
            <Field label={reasonLabel} required error={touched && missing ? 'Escribe el motivo para continuar.' : null}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus invalid={touched && !!missing} />
            </Field>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
