import { sendError } from './http.js';

export function requireOrg(req, res, next) {
  if (!req.orgId) return sendError(res, 403, 'NO_TENANT', 'This action requires a customer organization context.');
  return next();
}
