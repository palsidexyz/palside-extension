"use client";

import { X } from "lucide-react";
import { Toaster as SonnerToaster } from "sonner";
import type { ToasterProps } from "./toast";
import styles from "./toast.module.css";

/** Sonner keeps stacking, hover pause, swipe and timing; product tokens supply every visual. */
export default function Toaster({ label, closeLabel }: ToasterProps) {
  return <SonnerToaster
    className={styles.toaster}
    position="top-center"
    offset={12}
    mobileOffset={12}
    gap={8}
    visibleToasts={3}
    duration={4500}
    hotkey={[]}
    containerAriaLabel={label}
    closeButton
    icons={{ close: <X size={14} aria-hidden="true" /> }}
    toastOptions={{
      unstyled: true,
      closeButtonAriaLabel: closeLabel,
      classNames: { toast: styles.toast, content: styles.content, title: styles.title, actionButton: styles.action, closeButton: styles.close },
    }}
  />;
}
