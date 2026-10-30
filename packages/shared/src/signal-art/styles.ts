// Adapted from darrenprx/lolPing (MIT), c98806ae96a4dd83ca9c12be224878057f3d3ae7. See LICENSE.
/** Wheel, ping and emote styles for the page layer's ShadowRoot, in the product font. Sizes scale with --size, timing with --dur. */
export const signalArtCss = `#pings, #emotes { position: fixed; inset: 0; pointer-events: none; }

/* ---------- wheel: dark translucent sectors, restrained feedback ---------- */
#wheel {
  position: absolute; left: 0; top: 0; width: 600px; height: 600px; margin: -300px 0 0 -300px;
  pointer-events: none; opacity: 0; transform: scale(.85); transition: opacity .12s ease-out, transform .12s ease-out;
}
#wheel.open { opacity: 1; transform: scale(1); }
#wheel .wedge { transition: fill-opacity .08s; }
#wheel .icon { transition: filter .1s, transform .1s; transform-box: fill-box; transform-origin: center; }
#wheel .icon.hot { filter: brightness(1.12); transform: scale(1.04); }
#wheel .centerTxt { font: 600 15px Geist, ui-sans-serif, system-ui, sans-serif; fill: #16b8df; }
#wheel .backTxt { font: 12px Geist, ui-sans-serif, system-ui, sans-serif; fill: #7b8080; }

/* ---------- pings ---------- */
.ping { position: absolute; width: 0; height: 0; pointer-events: none; --size: 110px; --dur: 3.2s; }
.ping .ring {
  position: absolute; left: calc(var(--size) * -.28); top: calc(var(--size) * .03);
  width: calc(var(--size) * .56); height: calc(var(--size) * .22); box-sizing: border-box; border-radius: 50%;
  border: 1.4px solid var(--c); opacity: 0; animation: ring .7s ease-out forwards;
}
.ping .ring.r2 { animation-delay: .16s; }
.ping .art {
  position: absolute; left: calc(var(--size) * -0.5); top: calc(var(--size) * -0.73);
  width: var(--size); height: var(--size); animation: life var(--dur) linear forwards;
}
.ping .art img { position: absolute; inset: 0; width: 100%; height: 100%; }
.ping .pop { position: absolute; inset: 0; animation: pop .28s cubic-bezier(.2,1.6,.4,1) both, bob 1.6s ease-in-out .3s infinite; }
.ping .tag, .emote .tag {
  position: absolute; left: 0; top: calc(var(--size) * 0.5); transform: translateX(-50%); white-space: nowrap;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box;
  padding: 1px 7px; border-radius: 4px; background: rgba(8, 12, 16, .62); color: var(--tag);
  font: 600 13px/18px Geist, ui-sans-serif, system-ui, sans-serif; letter-spacing: .2px;
  text-shadow: 0 1px 2px #000; animation: tagIn .25s ease-out both, life var(--dur) linear forwards;
}
/* A kept ping skips the fade at the end of its life: its art stays, still bobbing, until it is removed. */
.ping.kept .art, .ping.kept .tag { animation-name: none; }
@keyframes tagIn { from { transform: translate(-50%, 4px) } }
@keyframes pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
@keyframes bob { 0%, 100% { translate: 0 0 } 50% { translate: 0 -5px } }
@keyframes ring { from { transform: scale(.65); opacity: .65 } to { transform: scale(1.4); opacity: 0 } }
@keyframes life { 0%, 87% { opacity: 1 } 100% { opacity: 0 } }

/* ---------- emotes (--size is the art's width, --dur the 3 s they stay) ---------- */
.emote { position: absolute; width: 0; height: 0; pointer-events: none; --size: 150px; --dur: 3s; }
.emote .tag { top: calc(var(--size) * 0.5 + 8px); }
/* The still plays in this envelope: pop in, bob, then shrink and fade over the last 0.35 s. */
.emote .fx {
  position: absolute; left: calc(var(--size) * -0.5); top: calc(var(--size) * -0.5); width: var(--size); height: var(--size);
  animation: emoteIn .25s ease-out both, emoteBob 1.4s ease-in-out infinite, emoteOut .35s ease-in calc(var(--dur) - .35s) forwards;
}
.emote .fx img { display: block; width: 100%; height: 100%; object-fit: contain; }
.emote .bubble {
  position: absolute; left: 8%; top: 8%; width: 84%; height: 68%; box-sizing: border-box; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #f4efe2; border: 3px solid #c8aa6e; color: #1f2a30;
  font: 600 calc(var(--size) * .4)/1 Geist, ui-sans-serif, system-ui, sans-serif;
}
@keyframes emoteIn { 0% { transform: scale(0) } 60% { transform: scale(1.15) } 100% { transform: scale(1) } }
@keyframes emoteBob { 0%, 100% { translate: 0 0 } 25% { translate: 0 -4px } 75% { translate: 0 4px } }
@keyframes emoteOut { from { transform: scale(1); opacity: 1 } to { transform: scale(.85); opacity: 0 } }
`;
