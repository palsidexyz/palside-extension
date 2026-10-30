export const captureStyles = `
    .capture-editor{position:fixed;inset:0;z-index:10;pointer-events:auto;cursor:crosshair;background:var(--pl-capture-backdrop);overflow:hidden;color:var(--pl-light-text);animation:capture-in .12s ease-out;user-select:none}
    @keyframes capture-in{from{opacity:0}}
    .capture-image{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
    .capture-scrim{position:absolute;inset:0;background:var(--pl-capture-scrim);pointer-events:none}
    .capture-editor[data-phase=edit] .capture-scrim{display:none}
    .capture-selection{position:absolute;outline:1px solid var(--pl-accent);box-shadow:0 0 0 9999px var(--pl-capture-scrim)}
    .capture-selection[hidden]{display:none}
    .capture-editor[data-phase=edit][data-locked=false]:not([data-tool]) .capture-selection,.capture-editor[data-phase=edit][data-locked=false][data-tool=""] .capture-selection{cursor:move}
    .capture-editor[data-tool]:not([data-tool=""]) .capture-selection{cursor:crosshair}
    .capture-editor[data-tool=text] .capture-selection{cursor:text}
    .capture-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .capture-size{position:absolute;left:0;bottom:calc(100% + 6px);padding:2px 6px;border-radius:var(--ui-radius-s);corner-shape:var(--ui-corner-shape);background:var(--pl-tip);color:var(--pl-on-dark);font:11px/14px "Geist Mono",ui-monospace,monospace;white-space:nowrap;pointer-events:none}
    .capture-size[data-inside=true]{bottom:auto;top:6px;left:6px}
    .capture-handle{position:absolute;width:8px;height:8px;background:var(--pl-light-surface);border:1px solid var(--pl-drop);border-radius:2px;z-index:2}
    .capture-editor[data-locked=true] .capture-handle{display:none}
    .capture-handle[data-handle=nw]{left:-4px;top:-4px;cursor:nwse-resize}.capture-handle[data-handle=n]{left:calc(50% - 4px);top:-4px;cursor:ns-resize}.capture-handle[data-handle=ne]{right:-4px;top:-4px;cursor:nesw-resize}.capture-handle[data-handle=e]{right:-4px;top:calc(50% - 4px);cursor:ew-resize}.capture-handle[data-handle=se]{right:-4px;bottom:-4px;cursor:nwse-resize}.capture-handle[data-handle=s]{left:calc(50% - 4px);bottom:-4px;cursor:ns-resize}.capture-handle[data-handle=sw]{left:-4px;bottom:-4px;cursor:nesw-resize}.capture-handle[data-handle=w]{left:-4px;top:calc(50% - 4px);cursor:ew-resize}
    .capture-text-input{position:absolute;min-width:24px;padding:0 2px;border-radius:3px;outline:1px dashed color-mix(in srgb,var(--pl-on-dark) 80%,transparent);background:transparent;font:600 18px/24px Geist,ui-sans-serif,system-ui,sans-serif;-webkit-text-stroke:3px color-mix(in srgb,var(--pl-outline) 45%,transparent);paint-order:stroke fill;white-space:pre;cursor:text;z-index:4;user-select:text}
    .capture-toolbar{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;border-radius:var(--ui-radius-l);corner-shape:var(--ui-corner-shape);background:var(--pl-light-surface);border:0;box-shadow:var(--ui-shadow-floating);cursor:default;white-space:nowrap;z-index:5}
    .capture-toolbar[hidden]{display:none}
    .capture-toolbar button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:calc(var(--ui-radius-l) - 4px);corner-shape:var(--ui-corner-shape);background:transparent;color:var(--pl-tool-ink);cursor:pointer;transition:background-color .12s}
    .capture-toolbar button:hover{background:var(--pl-light-hover);color:var(--pl-light-text)}
    .capture-toolbar button[aria-pressed=true]:not(.capture-color){background:var(--pl-light-pressed);color:var(--pl-light-text)}
    .capture-toolbar svg{width:16px;height:16px}
    .capture-toolbar .capture-color{width:22px;height:30px;border-radius:var(--ui-radius-s);corner-shape:var(--ui-corner-shape)}
    .capture-toolbar .capture-color::before{content:"";width:14px;height:14px;border-radius:50%;background:var(--swatch);box-shadow:inset 0 0 0 1px var(--pl-drop)}
    .capture-toolbar .capture-color[aria-pressed=true]::before{box-shadow:0 0 0 2px var(--pl-light-surface),0 0 0 3.5px var(--swatch)}
    .capture-separator{width:1px;height:18px;margin:0 3px;background:transparent}
    .capture-toolbar .capture-done{display:flex;gap:5px;width:auto;height:28px;margin-left:4px;padding:0 12px 0 10px;border-radius:var(--ui-radius-pill);background:var(--pl-solid);color:var(--pl-on-dark);font:600 12px/1 Geist,ui-sans-serif,system-ui,sans-serif}
    .capture-toolbar .capture-done:hover{background:var(--pl-solid-hover);color:var(--pl-on-dark)}
    .capture-toolbar .capture-done svg{width:14px;height:14px;stroke-width:2.2}
    .capture-toolbar button:focus-visible{outline:var(--ui-focus-width) solid var(--ui-text-secondary);outline-offset:var(--ui-focus-offset)}
    .capture-toast{position:absolute;padding:5px 10px;border-radius:var(--ui-radius-m);corner-shape:var(--ui-corner-shape);background:var(--pl-solid);color:var(--pl-on-dark);font:500 12px/16px Geist,ui-sans-serif,system-ui,sans-serif;pointer-events:none;z-index:6}
    .capture-toast[hidden]{display:none}
    @media(prefers-reduced-motion:reduce){.capture-editor{animation:none}}
`;
