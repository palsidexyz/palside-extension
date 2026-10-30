import { createCaptureEditor } from './capture';
import type { CaptureLabels,PageUp } from '../runtime/browser/page-protocol';
export function createCaptureHost(stage: HTMLElement, send: (message: PageUp) => void) {
  let captureEditor: ReturnType<typeof createCaptureEditor> | undefined;
  return {
startCapture(src: string, captureLabels: CaptureLabels) {
      captureEditor?.stop();
      captureEditor = createCaptureEditor(stage, send, src, captureLabels, () => { captureEditor = undefined; });
    },
stopCapture() {
      captureEditor?.stop();
      captureEditor = undefined;
    },
  };
}
