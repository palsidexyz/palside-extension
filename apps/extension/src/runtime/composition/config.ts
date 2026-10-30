/** Local builds use loopback; wxt.config.ts validates explicit HTTPS origins for release builds. */
export const API_URL = import.meta.env.WXT_API_URL || 'http://127.0.0.1:8787';
