import type { ComponentPropsWithRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { clsx } from "clsx";
import styles from "../../styles/visually-hidden.module.css";

export type VisuallyHiddenProps = ComponentPropsWithRef<"span"> & { asChild?: boolean };

/** Read by assistive technology, invisible on screen. `asChild` hides an element such as a heading or label instead of wrapping it. */
export function VisuallyHidden({ asChild = false, className, ...props }: VisuallyHiddenProps) {
  const Component = asChild ? Slot : "span";
  return <Component {...props} className={clsx(styles.visuallyHidden, className)} />;
}
