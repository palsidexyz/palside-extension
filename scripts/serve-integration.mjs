/** Test-only browser harness. Never a replacement for native Chrome extension acceptance. */
import { startReviewServer } from './lib/review-server.mjs';

const { server } = await startReviewServer({ port: Number(process.argv[2] ?? 5173) });
server.printUrls();
