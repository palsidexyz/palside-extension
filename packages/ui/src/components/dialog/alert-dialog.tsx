"use client";

import { useRef } from "react";
import { Button } from "../button";
import { InlineFeedback } from "../inline-feedback";
import { Dialog } from "./dialog";

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  placement?: "center" | "bottom";
  boundarySelector?: string;
  /** Destructive confirmations use the danger button, labelled with the action itself. */
  tone?: "danger";
};

/** The caller owns the request and closes only after success. Pending prevents accidental dismissal. */
export function AlertDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, pending = false, error, onConfirm, placement, boundarySelector, tone }: AlertDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} pending={pending} initialFocusRef={cancelRef} placement={placement} boundarySelector={boundarySelector}
    footer={<><Button ref={cancelRef} disabled={pending} onClick={() => onOpenChange(false)}>{cancelLabel}</Button><Button variant={tone === "danger" ? "danger" : "primary"} loadingLabel={confirmLabel} loading={pending} onClick={onConfirm}>{confirmLabel}</Button></>}>
    {error && <InlineFeedback tone="error">{error}</InlineFeedback>}
  </Dialog>;
}
