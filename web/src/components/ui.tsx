'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check, ChevronDown, X } from 'lucide-react';
import type { RideStatus } from '@/lib/types';

// ---- Status pill --------------------------------------------------------------
const STATUS_STYLE: Record<RideStatus, string> = {
  SCHEDULED: 'bg-primary-soft text-primary-dark',
  REQUESTED: 'bg-amber-soft text-[#8a6a00]',
  ACCEPTED: 'bg-primary-soft text-primary-dark',
  IN_PROGRESS: 'bg-amber text-ink',
  COMPLETED: 'bg-primary text-white',
  CANCELLED: 'bg-danger-soft text-danger',
  EXPIRED: 'bg-line text-slate2',
};

export function StatusPill({ status }: { status: RideStatus }) {
  const live = status === 'REQUESTED' || status === 'IN_PROGRESS';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}
    >
      {live && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />}
      {status.replace('_', ' ')}
    </span>
  );
}

// ---- Field --------------------------------------------------------------------
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {error && <span className="block text-[12px] font-medium text-danger">{error}</span>}
    </label>
  );
}

// ---- Select (Radix) -------------------------------------------------------------
export function ZoneSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value?: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onChange}>
      <SelectPrimitive.Trigger className="input flex items-center justify-between data-[placeholder]:text-slate2/60">
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 text-slate2" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 w-[var(--radix-select-trigger-width)] overflow-auto rounded-lg border border-line bg-white shadow-lift"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-[14px] outline-none data-[highlighted]:bg-primary-soft data-[highlighted]:text-primary-dark"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="h-4 w-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ---- Switch ---------------------------------------------------------------------
export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="relative h-7 w-12 rounded-full bg-line transition data-[state=checked]:bg-primary disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  );
}

// ---- Dialog ---------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-white p-5 shadow-lift focus:outline-none">
          <div className="mb-3 flex items-center justify-between">
            <DialogPrimitive.Title className="font-display text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-md p-1 text-slate2 hover:bg-paper">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---- Tabs -----------------------------------------------------------------------
export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ children }: { children: React.ReactNode }) => (
  <TabsPrimitive.List className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
    {children}
  </TabsPrimitive.List>
);
export const TabsTrigger = ({ value, children }: { value: string; children: React.ReactNode }) => (
  <TabsPrimitive.Trigger
    value={value}
    className="rounded-md px-3.5 py-1.5 text-[13px] font-semibold text-slate2 transition data-[state=active]:bg-primary data-[state=active]:text-white"
  >
    {children}
  </TabsPrimitive.Trigger>
);
export const TabsContent = TabsPrimitive.Content;

// ---- Misc -----------------------------------------------------------------------
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-line border-t-primary ${className}`}
      aria-label="loading"
    />
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="font-display font-semibold text-slate2">{title}</p>
      {hint && <p className="text-[13px] text-slate2/80">{hint}</p>}
    </div>
  );
}

export function Stars({
  value,
  onChange,
  size = 'text-2xl',
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: string;
}) {
  return (
    <div className={`flex gap-1 ${size}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`${n <= value ? 'text-amber' : 'text-line'} transition hover:scale-110 disabled:hover:scale-100`}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
