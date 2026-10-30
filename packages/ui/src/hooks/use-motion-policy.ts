"use client";

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Server and first hydration render share static markup. Later state changes
 * can animate using the actual browser preference, without a hydration mismatch. */
export function useMotionPolicy() {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const reduced = useReducedMotion();
  return { reduced, entrance: hydrated && !reduced };
}
