export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = 'Sign in to continue.') => new ApiError(401, message);
export const forbidden = (message = 'You do not have permission to do that.') => new ApiError(403, message);
export const notFound = (message = 'Not found.') => new ApiError(404, message);
export const conflict = (message, details) => new ApiError(409, message, details);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error('[entryout] internal error', err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
    // Field-level problems, keyed by form field name.
    errors: err.details && typeof err.details === 'object' ? err.details : undefined,
  });
}

/** Wrap async route handlers so rejections reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
