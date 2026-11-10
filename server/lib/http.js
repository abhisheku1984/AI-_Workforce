export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendError(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

export function ok(res, data, meta) {
  return res.json(meta ? { data, meta } : { data });
}

export const badRequest = (message, details) => new ApiError(400, 'VALIDATION_FAILED', message, details);
export const notFound = (what = 'Record') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message) => new ApiError(409, 'CONFLICT', message);

export function paginate(query, defaultLimit = 50, maxLimit = 500) {
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), maxLimit);
  const page = Math.max(Number(query.page) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}
