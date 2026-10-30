import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { startBackground } from '../src/background/index.ts';

export default defineBackground(() => {
  startBackground({ browser, websiteUrl: import.meta.env.WXT_WEBSITE_URL || 'http://localhost:3000' });
});
