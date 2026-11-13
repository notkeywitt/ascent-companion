"use client";

/**
 * One way to confirm a save: `toast("Saved")` from any client code. The host
 * (<ToastHost/>, mounted once in layout.tsx) draws them above the tab bar,
 * clears each after 4 seconds, and lets a swipe dismiss one. Built on Base UI's
 * Toast, which announces each one to a screen reader.
 *
 * A failure that the user must act on is not a toast. Show it in place with a
 * `Banner` or `Notice`, where it stays until fixed.
 */

import { Toast } from "@base-ui/react/toast";

const manager = Toast.createToastManager();

export function toast(
  title: string,
  opts: { description?: string; tone?: "success" | "error"; action?: { label: string; onClick: () => void } } = {},
) {
  const id = manager.add({
    title,
    description: opts.description,
    type: opts.tone ?? "success",
    actionProps: opts.action && {
      children: opts.action.label,
      onClick: () => {
        manager.close(id);
        opts.action!.onClick();
      },
    },
  });
  return id;
}

function List() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg transition-[opacity,transform] duration-200 [transform:translateY(var(--toast-swipe-movement-y,0px))] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-neutral-100 dark:text-neutral-900"
    >
      <span aria-hidden className={t.type === "error" ? "text-red-300 dark:text-danger" : ""}>
        {t.type === "error" ? "⚠" : "✓"}
      </span>
      <div className="min-w-0 flex-1">
        <Toast.Title className="font-medium" />
        <Toast.Description className="text-xs opacity-80" />
      </div>
      <Toast.Action className="min-h-11 shrink-0 px-2 font-semibold underline underline-offset-2" />
    </Toast.Root>
  ));
}

export function ToastHost() {
  return (
    <Toast.Provider toastManager={manager} timeout={4000} limit={3}>
      <Toast.Portal>
        <Toast.Viewport
          className="pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-[calc(100%-2rem)] max-w-sm flex-col-reverse gap-2 print:hidden"
          style={{ bottom: "calc(var(--tabbar-h) + var(--actionbar-h) + 0.75rem)", left: "var(--rail-w)" }}
        >
          <List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
