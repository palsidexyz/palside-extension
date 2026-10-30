import { endpoint, jsonBody, jsonResponse } from '../endpoint.ts';
import { operationErrors } from '../errors.ts';
import { reportSubmission, reportResult } from '../reports.ts';
export const reportEndpoints = [
  endpoint({ id: 'reports.submit', method: 'POST', path: '/reports', authorization: 'resource', idempotency: 'required', rateLimits: ['report'], body: jsonBody(reportSubmission), response: jsonResponse(reportResult), errors: [...operationErrors, 'INVALID_REPORT', 'REPORT_IMAGE_UNAVAILABLE', 'REPORT_UNAVAILABLE', 'TEAM_NOT_FOUND', 'ACCOUNT_UNAVAILABLE'] }),
] as const;
