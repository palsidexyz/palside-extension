import { useRef, type MouseEvent, type PointerEvent } from "react";

export function useBackdropDismiss(isBackdrop: (event: MouseEvent<HTMLDialogElement>) => boolean, dismiss: () => void) {
  const outsidePress = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      outsidePress.current = isBackdrop(event);
    },
    onPointerCancel() {
      outsidePress.current = false;
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismisses = outsidePress.current && isBackdrop(event);
      outsidePress.current = false;
      if (dismisses) {
        event.stopPropagation();
        dismiss();
      }
    },
  };
}
