import { useEffect, useSyncExternalStore } from 'react';

/**
 * A tiny toast system (ruling L6: our own, ~80 lines, no dependency).
 *
 * `showToast` works from anywhere, including before the app is visible; a
 * toast's countdown only starts while the `<Toaster>` is actually shown, so a
 * message raised at startup (under the landing page) is still there to read.
 */

type ToastAction = { label: string; run(): void };
type Toast = { id: number; message: string; action?: ToastAction; timeoutMs: number };

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(next: readonly Toast[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function showToast(toast: { message: string; action?: ToastAction; timeoutMs?: number }): number {
  const id = nextId++;
  emit([...toasts, { id, message: toast.message, action: toast.action, timeoutMs: toast.timeoutMs ?? 8000 }]);
  return id;
}

function dismissToast(id: number): void {
  emit(toasts.filter((toast) => toast.id !== id));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function ToastItem({ toast, paused }: { toast: Toast; paused: boolean }) {
  useEffect(() => {
    if (paused) return;
    const handle = window.setTimeout(() => dismissToast(toast.id), toast.timeoutMs);
    return () => window.clearTimeout(handle);
  }, [toast, paused]);
  return (
    <div
      role='status'
      className='pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-md border border-secondary-dark-gray bg-primary-dark-gray px-3 py-2 text-[13px] text-primary-white shadow-lg'
    >
      <span className='min-w-0 flex-1'>{toast.message}</span>
      {toast.action && (
        <button
          type='button'
          className='cursor-pointer rounded px-2 py-0.5 text-[12px] font-semibold text-primary-blue hover:bg-secondary-dark-gray'
          onClick={() => {
            toast.action?.run();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type='button'
        aria-label='Dismiss'
        className='cursor-pointer rounded px-1 text-primary-light-gray hover:bg-secondary-dark-gray hover:text-primary-white'
        onClick={() => dismissToast(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

/** Bottom-right stack. `paused` (the app is covered) holds every countdown. */
function Toaster({ paused }: { paused: boolean }) {
  const current = useSyncExternalStore(subscribe, () => toasts);
  if (current.length === 0) return null;
  return (
    <div aria-live='polite' className='pointer-events-none fixed right-4 bottom-4 z-900 flex flex-col items-end gap-2'>
      {current.map((toast) => (
        <ToastItem key={toast.id} toast={toast} paused={paused} />
      ))}
    </div>
  );
}

export { dismissToast, showToast, Toaster };
