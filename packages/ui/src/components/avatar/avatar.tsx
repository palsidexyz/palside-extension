"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { UserRound } from "lucide-react";
import { clsx } from "clsx";
import { avatarInitials } from "../../internal/display-values";
import styles from "./avatar.module.css";

export type AvatarProps = {
  name: string;
  fallbackLabel: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  /** `rounded` is the squad-avatar shape. */
  shape?: "circle" | "rounded";
  /** `contain` shows the whole image on a transparent face, for illustrated default avatars. */
  fit?: "cover" | "contain";
  className?: string;
};

function AvatarImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // Native image semantics work in both hosts; no Next image server is required.
  return <motion.img className={styles.avatarImage} src={src} alt="" aria-hidden="true"
    draggable={false} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function Avatar({ name, fallbackLabel, src, size = "md", shape = "circle", fit = "cover", className }: AvatarProps) {
  const initials = avatarInitials(name);
  return <span className={clsx(styles.avatar, className)} data-slot="avatar" data-size={size} data-shape={shape} data-fit={fit} role="img" aria-label={name.trim() || fallbackLabel} title={name.trim() || fallbackLabel}>
    <span aria-hidden="true">{initials || <UserRound size={16} />}</span>
    {src && <AvatarImage key={src} src={src} />}
  </span>;
}
