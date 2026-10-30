import { captureStyles } from './capture-styles';
import { paletteCss } from './palette';
export const overlayStyles = `
    ${paletteCss}
    *{box-sizing:border-box}
    .stage{position:fixed;
      inset:0;
      pointer-events:none;
      font:500 12px/16px Geist,ui-sans-serif,system-ui,sans-serif;
      color:var(--pl-on-dark)}
    .stage[data-theme=light] .edge{background:var(--pl-light-surface);
      color:var(--pl-light-text);
      border:0}
    .danmaku-area{position:fixed;pointer-events:none;overflow:hidden}
    .danmaku-area>div,.danmaku-area>div>div{pointer-events:none!important}
    .danmaku-area>div>div{display:flow-root}
    .room-payments{position:absolute;top:12px;right:12px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;width:min(360px,calc(100% - 24px));pointer-events:none}
    .room-payments button{pointer-events:auto;max-width:100%;border:0;border-radius:var(--ui-radius-m);corner-shape:var(--ui-corner-shape);padding:10px 14px;background:var(--pl-light-surface);color:var(--pl-light-text);font:500 13px/20px Geist,system-ui,sans-serif;text-align:left;cursor:pointer}
    .stage[data-theme=dark] .room-payments button{background:var(--pl-dark-surface);color:var(--pl-on-dark)}
    .dm{position:relative;margin:2px 24px 2px 0;pointer-events:auto;display:block;padding:0 6px;border-radius:var(--ui-radius-xs);corner-shape:var(--ui-corner-shape);white-space:nowrap;color:var(--pl-on-dark);opacity:var(--dm-opacity,1);font:bold 24px/30px SimHei,"Microsoft JhengHei",Arial,Helvetica,sans-serif;text-shadow:1px 0 1px var(--pl-outline),0 1px 1px var(--pl-outline),0 -1px 1px var(--pl-outline),-1px 0 1px var(--pl-outline);cursor:pointer;transition:background-color .12s}
    .dm[data-size=sm]{font-size:20px;line-height:26px}
    .dm[data-size=lg]{font-size:28px;line-height:34px}
    .dm[data-mate]{color:var(--pl-dm-mate)}
    .dm[data-self]{background:var(--pl-dm-self-fill);box-shadow:inset 0 0 0 1px var(--pl-dm-self)}
    .stage[data-theme=light] .dm[data-self]{background:var(--pl-dm-self-fill-light)}
    .dm:hover{background:var(--pl-dm-hover)}
    .danmaku-area>div>div[data-held]{z-index:1}
    .dm-card{position:absolute;left:0;top:0;z-index:2;display:flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 6px;border-radius:var(--ui-radius-pill);background:var(--pl-dark-surface);color:var(--pl-dark-text);box-shadow:var(--ui-shadow-floating);font:500 12px/16px Geist,ui-sans-serif,system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .16s cubic-bezier(.22,1,.36,1),transform .16s cubic-bezier(.22,1,.36,1)}
    .dm-card[hidden]{display:none}
    .dm-card[data-on]{opacity:1;transform:none}
    .dm-card .avatar{width:24px;height:24px;font-size:11px}
    .dm-card[data-mate] .avatar{box-shadow:0 0 0 1.5px var(--pl-dark-surface),0 0 0 2.5px var(--pl-dm-mate)}
    .dm-card b{font-size:13px;font-weight:600}
    .dm-tag{height:18px;padding:0 6px;border-radius:var(--ui-radius-pill);background:color-mix(in srgb,var(--pl-dm-mate) 16%,transparent);color:var(--pl-dm-mate);font-size:11px;line-height:18px;font-weight:600}
    .dm-card time{color:var(--pl-dark-muted)}
    .stage[data-theme=light] .dm-card{background:var(--pl-light-surface);color:var(--pl-light-text)}
    .stage[data-theme=light] .dm-card[data-mate] .avatar{box-shadow:0 0 0 1.5px var(--pl-light-surface),0 0 0 2.5px var(--pl-ink-accent)}
    .stage[data-theme=light] .dm-tag{background:color-mix(in srgb,var(--pl-accent) 18%,var(--pl-light-surface));color:var(--pl-ink-accent)}
    .stage[data-theme=light] .dm-card time{color:var(--pl-light-muted)}
    :host([data-reduced]) .dm-card{transition:none;transform:none}
    .avatar{width:18px;
      height:18px;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:var(--pl-accent);
      color:var(--pl-on-accent);
      font-size:10px;
      overflow:hidden;
      flex:none}
    .avatar img{width:100%;
      height:100%;
      object-fit:cover}
    .box{position:fixed;
      border:1px solid var(--pl-accent);
      border-radius:var(--ui-radius-s);corner-shape:var(--ui-corner-shape);
      background:color-mix(in srgb,var(--pl-accent) 12%,transparent);
      outline:1px solid var(--pl-hairline)}
    .tag{position:absolute;
      left:-2px;
      bottom:calc(100% + 4px);
      display:flex;
      align-items:center;
      gap:5px;
      height:22px;
      max-width:280px;
      padding:0 8px;
      border-radius:var(--ui-radius-m);corner-shape:var(--ui-corner-shape);
      background:var(--pl-accent);
      color:var(--pl-on-accent);
      white-space:nowrap}
    .edge{pointer-events:auto;
      border:0;
      background:var(--pl-dark-surface);
      color:var(--pl-on-dark);
      border:0;
      cursor:pointer}
    .edge{position:fixed;
      left:50%;
      height:30px;
      padding:0 12px;
      border-radius:var(--ui-radius-l);corner-shape:var(--ui-corner-shape);
      transform:translateX(-50%)}
    .box.leaving{opacity:0;transition:opacity .3s ease}
    .document-layer{position:absolute;left:0;top:0;width:0;height:0;font:500 12px/16px Geist,ui-sans-serif,system-ui,sans-serif}.pins{position:absolute;left:0;top:0;pointer-events:none}.pins[hidden]{display:none}.static-dm{position:absolute;top:8px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:4px}.static-dm .dm{animation:dm-fade 5s both;background:color-mix(in srgb,var(--pl-dark-surface) 90%,transparent);border:0;text-shadow:none}@keyframes dm-fade{0%,100%{opacity:0}10%,90%{opacity:1}}
    .pin{position:absolute;left:0;top:0;display:flex;align-items:center;gap:0;height:28px;min-width:28px;padding:3px;border:1px solid var(--pl-note-edge);border-radius:var(--ui-radius-l) var(--ui-radius-l) var(--ui-radius-l) 3px;corner-shape:var(--ui-corner-shape);background:var(--pl-note);color:var(--pl-note-ink);pointer-events:auto;cursor:pointer;transform-origin:0 100%;transition:background-color .12s ease-out}
    :host([data-reduced]) .pin{transition:none}
    .pin:hover,.pin:focus-visible{background:var(--pl-note-hover);z-index:1}
    .pin:focus-visible{outline:var(--ui-focus-width) solid var(--ui-text-secondary);outline-offset:var(--ui-focus-offset)}
    .pin[data-flip]{border-radius:var(--ui-radius-l) var(--ui-radius-l) 3px var(--ui-radius-l);corner-shape:var(--ui-corner-shape);transform-origin:100% 100%}
    .pin .avatar{width:22px;height:22px;font-size:11px;border:1px solid var(--pl-note-edge)}
    .pin .avatar+.avatar{margin-left:-6px}
    .pin .count{min-width:16px;padding:0 4px 0 3px;font:600 11px/22px Geist,ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .pin[data-off]{display:none}
    .sticky-card{position:absolute;left:0;top:0;z-index:2;display:none;flex-direction:column;width:max-content;max-width:260px;max-height:320px;overflow:auto;border-radius:var(--ui-radius-l);corner-shape:var(--ui-corner-shape);background:var(--pl-note-paper);color:var(--pl-note-text);border:1px solid color-mix(in srgb,var(--pl-note-edge) 25%,transparent);box-shadow:var(--ui-shadow-floating);pointer-events:auto}
    .sticky-card.open{display:flex}
    .sticky-note{padding:9px 12px 10px}
    .sticky-note+.sticky-note{border-top:1px solid color-mix(in srgb,var(--pl-note-ink) 12%,transparent)}
    .sticky-head{display:flex;align-items:center;gap:6px;min-width:0;font:500 11px/16px Geist,ui-sans-serif,system-ui,sans-serif;color:color-mix(in srgb,var(--pl-note-text) 60%,transparent)}
    .sticky-head b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--pl-note-text)}
    .sticky-head .avatar{width:16px;height:16px;font-size:9px}
    .sticky-note p{margin:4px 0 0;font:500 13px/19px Geist,ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}
    .selection{position:absolute;left:0;top:0;width:max-content;display:flex;flex-wrap:wrap;gap:4px;max-width:calc(100vw - 16px);padding:5px;border:0;border-radius:var(--ui-radius-l);corner-shape:var(--ui-corner-shape);background:var(--pl-light-surface);color:var(--pl-light-text);box-shadow:var(--ui-shadow-floating);pointer-events:auto;z-index:13}
    .selection button{white-space:nowrap;border:0;border-radius:calc(var(--ui-radius-l) - 5px);corner-shape:var(--ui-corner-shape);padding:8px 10px;background:transparent;color:inherit;font:500 13px/18px Geist,system-ui;cursor:pointer}
    .selection button:hover{background:var(--pl-light-hover)}.selection button:disabled{opacity:.5;cursor:default}
    .selection [role=alert]{flex-basis:100%;font:12px/18px Geist,system-ui;color:var(--pl-error);padding:2px 6px}
    @media(prefers-reduced-motion:reduce){.pin{transition:none}.box.leaving{transition:none}}
    ${captureStyles}
  `;
