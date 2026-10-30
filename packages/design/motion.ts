import type { Transition } from "motion/react";

/** Shared product timing; each component retains its own choreography. */
export const motionPresets = {
  feedback: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  reorder: { type: "spring", stiffness: 320, damping: 30 },
  expand: { type: "spring", bounce: 0.16, duration: 0.5 },
  reduced: { duration: 0 },
} as const satisfies Record<string, Transition>;
