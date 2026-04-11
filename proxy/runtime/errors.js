function sendError(res, statusCode, message, details, code, requestId) {
  res.status(statusCode).json({
    success: false,
    error: {
      code: code || 'INTERNAL_ERROR',
      message,
      details: details || null
    },
    requestId: requestId || null
  });
}

module.exports = {
  sendError
};
