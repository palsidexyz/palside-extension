"use client";

import { useImperativeHandle, type ComponentPropsWithRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { clsx } from "clsx";
import { PopoverLayer, PopoverRoot, PopoverTrigger, usePopoverContext, type PopoverContentProps, type PopoverProps, type PopoverTriggerProps } from "../popover/popover";
import styles from "./menu.module.css";

const ITEM = "[role='menuitem']:not(:disabled)";

export type MenuProps = PopoverProps;

/** A list of actions anchored to a trigger, with arrow-key navigation (WAI-ARIA menu button). */
export function Menu(props: MenuProps) {
  return <PopoverRoot kind="menu" {...props} />;
}

export type MenuTriggerProps = PopoverTriggerProps;

export function MenuTrigger(props: MenuTriggerProps) {
  return <PopoverTrigger {...props} />;
}

export type MenuOpenerHandle = {
  /** Opens the menu at a viewport point. `held`: a mouse button is still down (a context menu on press), so it opens on release, which would otherwise dismiss it. */
  openAt: (x: number, y: number, held?: boolean) => void;
};

/** Lets an area other than the trigger open this menu at the pointer, as its context menu; focus returns to the trigger as usual. */
export function MenuOpener({ ref }: { ref: Ref<MenuOpenerHandle> }) {
  const { openAt, pointerOpenRef } = usePopoverContext();
  useImperativeHandle(ref, () => ({
    openAt(x, y, held = false) {
      const open = () => { pointerOpenRef.current = true; openAt(x, y); };
      if (held) addEventListener("pointerup", open, { once: true, capture: true }); else open();
    },
  }), [openAt, pointerOpenRef]);
  return null;
}

export type MenuContentProps = PopoverContentProps;

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const target = { ArrowDown: items[(index + 1) % items.length], ArrowUp: index === -1 ? items.at(-1) : items[(index - 1 + items.length) % items.length], Home: items[0], End: items.at(-1) }[event.key];
  if (!target) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
}

export function MenuContent({ onKeyDown, ...props }: MenuContentProps) {
  const { close } = usePopoverContext();
  return <PopoverLayer {...props} firstFocus={ITEM} onKeyDown={(event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Tab") { close(false); return; }
    moveFocus(event);
  }} />;
}

export type MenuItemProps = Omit<ComponentPropsWithRef<"button">, "type"> & {
  icon?: ReactNode;
  tone?: "neutral" | "danger";
};

/** Runs its action and closes the menu, unless the click handler calls `preventDefault()`. */
export function MenuItem({ icon, tone = "neutral", className, children, onClick, ...props }: MenuItemProps) {
  const { close } = usePopoverContext();
  return <button {...props} type="button" role="menuitem" tabIndex={-1} className={clsx(styles.item, className)} data-slot="menu-item" data-tone={tone}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) close(); }}>
    {icon && <span className={styles.itemIcon} aria-hidden="true">{icon}</span>}
    <span className={styles.itemLabel}>{children}</span>
  </button>;
}
