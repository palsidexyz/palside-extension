"use client";

import { Button, type ButtonProps } from "./button";
import { clsx } from "clsx";
import styles from "./button.module.css";

export type IconButtonProps = Omit<ButtonProps, "leadingIcon" | "aria-label"> & { label: string };

export function IconButton({ label, className, children, ...props }: IconButtonProps) {
  return <Button {...props} aria-label={label} title={props.title ?? label} className={clsx(styles.iconButton, className)} data-slot="icon-button">
    <span className={styles.icon} aria-hidden="true">{children}</span>
  </Button>;
}
