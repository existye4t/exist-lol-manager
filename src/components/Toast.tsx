import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useNotificationStore } from "@/stores/notifications";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  type?: ToastType;
  timeout?: number;
  action?: ToastAction;
  /**
   * A mark of the toast's own, where the type's glyph is not the subject.
   *
   * Sized as the type glyphs are, `h-5 w-5`, and coloured by the caller. The
   * stripe and the countdown stay the type's either way, so the line is still
   * found as an info toast by everything except its mark.
   */
  icon?: ReactNode;
  /**
   * How far a running task has got, 0-100, in the countdown's place.
   *
   * A toast that stays until its work ends has no dismissal to count down, so
   * the strip along its bottom reports the work instead.
   */
  progress?: number;
}

export interface ToastOptions {
  /** Also record the toast in the notification center. Off by default. */
  notify?: boolean;
}

/** A handle on a toast that stays open until the work behind it ends. */
export interface ToastTask {
  /** Move the strip along the bottom, and say what is happening now. */
  report: (percent: number, description: string) => void;
  close: () => void;
}

const typeIcons: Record<ToastType, ReactNode> = {
  success: <CircleCheck className="h-5 w-5 text-success-text" />,
  error: <CircleX className="h-5 w-5 text-danger-text" />,
  warning: <CircleAlert className="h-5 w-5 text-warning-text" />,
  info: <Info className="h-5 w-5 text-info-text" />,
};

const typeStripeClasses: Record<ToastType, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
};

const typeProgressColors: Record<ToastType, string> = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

/**
 * The countdown, and what ends the toast when it runs out.
 *
 * The strip is what a reader is watching, so it is what decides: base-ui runs a
 * timer of its own and pauses it on rules this one does not share - a window
 * that was not focused when the toast arrived leaves it paused - which left
 * empty strips sitting on screen.
 */
function ToastProgressBar({
  timeout,
  type,
  paused,
  onExpire,
}: {
  timeout: number;
  type: ToastType;
  paused: boolean;
  onExpire: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const startTimeRef = useRef(Date.now());
  const elapsedBeforePauseRef = useRef(0);
  const rafRef = useRef<number>(undefined);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  });

  useEffect(() => {
    if (paused) {
      elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
      const remaining = Math.max(0, 100 - (elapsed / timeout) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      expire.current();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [paused, timeout]);

  return (
    <div className="absolute right-0 bottom-0 left-0 h-0.5 overflow-hidden rounded-b-lg">
      <div
        className={twMerge("h-full transition-none", typeProgressColors[type])}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* The accent rather than the type color, because this strip reports work
   rather than a status. */
function ToastTaskBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="absolute right-0 bottom-0 left-0 h-1 overflow-hidden rounded-b-lg bg-surface-700">
      <div
        className="h-full bg-accent-500 transition-[width] duration-150"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

interface ToastItemProps {
  toast: BaseToast.Root.ToastObject<ToastData>;
}

export function ToastItem({ toast }: ToastItemProps) {
  const { close } = BaseToast.useToastManager();
  const type = toast.data?.type ?? "info";
  const timeout = toast.data?.timeout ?? 5000;
  const progress = toast.data?.progress;
  const icon = toast.data?.icon ?? typeIcons[type];
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <BaseToast.Root
      toast={toast}
      className={twMerge(
        "relative flex w-full flex-col overflow-hidden rounded-md border border-l-[3px] shadow-lg backdrop-blur-sm",
        "border-surface-700 bg-surface-800/95",
        typeStripeClasses[type],
        "transition-[transform,opacity,max-height] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "data-[swipe=move]:transition-none",
        "data-[swipe=cancel]:translate-x-0",
        "animate-toast-slide-in",
        "data-[ending-style]:translate-x-[40%] data-[ending-style]:opacity-0",
      )}
      style={{
        transform: `translateX(var(--toast-swipe-movement-x, 0))`,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <BaseToast.Content className="flex flex-1 items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 space-y-1">
          <BaseToast.Title className="text-sm font-medium text-surface-100" />
          <BaseToast.Description className="text-sm text-surface-400" />
          {toast.data?.action && (
            <button
              type="button"
              /* The action is the way out as much as the ✕ is: a toast still
                 sitting there is a press the reader has to make twice. */
              onClick={() => {
                toast.data?.action?.onClick();
                close(toast.id);
              }}
              className="mt-1 cursor-pointer text-sm font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
              {toast.data.action.label}
            </button>
          )}
        </div>
        <BaseToast.Close
          className="shrink-0 rounded-md p-1 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </BaseToast.Close>
      </BaseToast.Content>
      {progress === undefined && (
        <ToastProgressBar
          timeout={timeout}
          type={type}
          paused={hovered}
          onExpire={() => close(toast.id)}
        />
      )}
      {progress !== undefined && <ToastTaskBar value={progress} />}
    </BaseToast.Root>
  );
}

export function ToastList() {
  const { toasts } = BaseToast.useToastManager();

  return (
    <>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast as BaseToast.Root.ToastObject<ToastData>} />
      ))}
    </>
  );
}

// Re-export hook for convenience
export const useToastManager = BaseToast.useToastManager;

// Helper function to create typed toasts
export function useToast() {
  const toastManager = BaseToast.useToastManager();
  const addNotification = useNotificationStore((s) => s.addNotification);

  return {
    toast: (options: {
      title?: string;
      description?: string;
      type?: ToastType;
      timeout?: number;
      action?: ToastAction;
      icon?: ReactNode;
      notify?: boolean;
    }) => {
      const type = options.type ?? "info";
      const timeout = options.timeout ?? 5000;
      if (options.notify && options.title) {
        addNotification({ title: options.title, description: options.description, type });
      }
      return toastManager.add({
        title: options.title,
        description: options.description,
        data: { type, timeout, action: options.action, icon: options.icon },
        timeout,
      });
    },
    success: (title: string, description?: string, options?: ToastOptions) => {
      if (options?.notify) {
        addNotification({ title, description, type: "success" });
      }
      return toastManager.add({
        title,
        description,
        data: { type: "success", timeout: 5000 },
        timeout: 5000,
      });
    },
    error: (title: string, description?: string, options?: ToastOptions) => {
      if (options?.notify) {
        addNotification({ title, description, type: "error" });
      }
      return toastManager.add({
        title,
        description,
        data: { type: "error", timeout: 7000 },
        timeout: 7000,
      });
    },
    warning: (title: string, description?: string, options?: ToastOptions) => {
      if (options?.notify) {
        addNotification({ title, description, type: "warning" });
      }
      return toastManager.add({
        title,
        description,
        data: { type: "warning", timeout: 6000 },
        timeout: 6000,
      });
    },
    info: (title: string, description?: string, options?: ToastOptions) => {
      if (options?.notify) {
        addNotification({ title, description, type: "info" });
      }
      return toastManager.add({
        title,
        description,
        data: { type: "info", timeout: 5000 },
        timeout: 5000,
      });
    },
    /**
     * A toast that stays until the work behind it ends, reporting how far it
     * has got where a dismissing toast counts itself down.
     *
     * For work the user did not start and cannot cancel. Anything they can wait
     * on belongs in the UI that started it.
     */
    task: (title: string, description?: string): ToastTask => {
      const id = toastManager.add({
        title,
        description,
        data: { type: "info", progress: 0 },
        timeout: 0,
      });

      return {
        report: (percent: number, description: string) => {
          toastManager.update(id, {
            description,
            data: { type: "info", progress: percent },
          });
        },
        close: () => toastManager.close(id),
      };
    },
    dismiss: (toastId: string) => {
      toastManager.close(toastId);
    },
    promise: toastManager.promise,
  };
}
