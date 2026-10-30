import './ui-review';

// Test-only event trace: the production UI is imported without behavior overrides.
const output = document.createElement('pre');
output.id = 'pointer-trace';
output.hidden = true;
document.body.append(output);
const events: unknown[] = [];
for (const name of ['pointerdown', 'pointerup', 'click', 'focusin', 'focusout']) {
  document.addEventListener(name, event => {
    const target = event.target as HTMLElement;
    const layer = document.querySelector<HTMLElement>('[popover]:popover-open');
    const related = event instanceof FocusEvent ? event.relatedTarget as HTMLElement | null : null;
    events.push({ event: name, target: target?.closest('button')?.textContent || target?.tagName,
      related: related?.tagName, pointer: layer && getComputedStyle(layer).pointerEvents,
      parentPointer: layer?.parentElement && getComputedStyle(layer.parentElement).pointerEvents,
      focus: document.activeElement?.tagName });
    output.textContent = JSON.stringify(events.slice(-40));
  }, true);
}
