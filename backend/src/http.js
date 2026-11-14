class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
// Express 4 does not forward rejected async handlers automatically.
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status =
    error instanceof HttpError
      ? error.status
      : error.code === 'LIMIT_FILE_SIZE'
        ? 413
        : error.name === 'MulterError'
          ? 400
          : error.type === 'entity.parse.failed'
            ? 400
            : error.type === 'entity.too.large'
              ? 413
              : 500;
  const code =
    error instanceof HttpError
      ? error.code
      : error.code === 'LIMIT_FILE_SIZE'
        ? 'FILE_TOO_LARGE'
        : error.name === 'MulterError'
          ? 'INVALID_UPLOAD'
          : status === 400
            ? 'INVALID_JSON'
            : status === 413
              ? 'REQUEST_TOO_LARGE'
              : 'SERVER_ERROR';
  const message =
    error instanceof HttpError
      ? error.message
      : status === 413
        ? 'The request exceeds the size limit.'
        : status === 400
          ? 'The request body must be valid JSON.'
          : 'An unexpected error occurred.';
  res.status(status).json({ error: message, code, message });
}
module.exports = { HttpError, asyncRoute, errorHandler };
