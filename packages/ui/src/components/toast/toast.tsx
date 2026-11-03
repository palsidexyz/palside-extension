"use client";

import { lazy, Suspense } from "react";
import type { ExternalToast } from "sonner";

export type ToasterProps = {
  /** Translated accessible name of the toast region. */
  label: string;
  /** Translated accessible name of each toast's close button. */
  closeLabel: string;
};

// Notices are never part of the first frame, so Sonner loads after the panel does.
// Calls made before it arrives run in order once it has; Sonner replays toasts still active when the Toaster subscribes.
const sonner = () => import("sonner");
const LazyToaster = lazy(() => import("./toaster"));

/** Sonner keeps stacking, hover pause, swipe and timing; product tokens supply every visual. One per host. */
export function Toaster(props: ToasterProps) {
  return <Suspense fallback={null}><LazyToaster {...props} /></Suspense>;
}

/** Shows a translated one-line notice; the same `id` updates it in place. */
export function toast(message: string, options?: ExternalToast) {
  void sonner().then(module => { module.toast(message, options); });
}

/** Dismisses one notice, or every notice without an id. */
toast.dismiss = (id?: string | number) => {
  void sonner().then(module => { module.toast.dismiss(id); });
};
