'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

export const TOAST_DURATION_MS = 2400;

/** `alert` for a failure the learner must notice (role="alert"). */
export type ToastTone = 'status' | 'alert';

type Toast = { id: number; message: string; tone: ToastTone };

type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast | null>(null);

/** One shared live region for the learner shell; each toast leaves after 2.4 s. */
export function LearnerToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'status') => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_DURATION_MS);
      timers.current.add(timer);
    },
    [],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast"
            role={toast.tone === 'alert' ? 'alert' : undefined}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useLearnerToast(): ShowToast {
  const showToast = useContext(ToastContext);
  if (!showToast) {
    throw new Error('useLearnerToast must be used inside LearnerToastProvider');
  }
  return showToast;
}

type ToastButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'onClick' | 'type'
> & { message: string };

/** Button for a screen that has not shipped yet: it only shows a toast. */
export function ToastButton({ message, children, ...props }: ToastButtonProps) {
  const showToast = useLearnerToast();
  return (
    <button {...props} type="button" onClick={() => showToast(message)}>
      {children}
    </button>
  );
}
