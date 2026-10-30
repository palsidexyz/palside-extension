declare module 'danmaku/dist/esm/danmaku.dom.js' {
  type Comment = {
    node?: HTMLElement;
    mode?: 'ltr' | 'rtl' | 'top' | 'bottom';
    time?: number;
    render?: () => HTMLElement;
  };
  export default class Danmaku {
    constructor(options: { container: HTMLElement; media?: HTMLMediaElement; engine?: 'dom'; speed?: number });
    speed: number;
    comments: Comment[];
    _: { position: number; runningList: Comment[] };
    emit(comment: Comment): Danmaku;
    clear(): Danmaku;
    show(): Danmaku;
    hide(): Danmaku;
    resize(): Danmaku;
    destroy(): Danmaku;
  }
}
