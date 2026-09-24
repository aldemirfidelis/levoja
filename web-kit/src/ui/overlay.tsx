'use client';

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Button, Textarea, cn } from './primitives';

export function Dialog({
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
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-3xl',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </header>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmação de ação, com justificativa opcional/obrigatória (ex.: reprovar, bloquear). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'success';
  reason?: { label: string; required: boolean; placeholder?: string };
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setText('');
      setError(undefined);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason?.required && !text.trim()) {
      setError('Informe o motivo.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {reason && (
          <Textarea
            label={reason.label}
            required={reason.required}
            placeholder={reason.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant={tone} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
