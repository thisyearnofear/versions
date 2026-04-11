function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validateMode(value) {
  return value === 'music' || value === 'sfx';
}

function validatePromptText(value, fieldName) {
  if (typeof value !== 'string') {
    return `${fieldName} must be a string`;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return `${fieldName} is required`;
  }

  if (trimmed.length > 500) {
    return `${fieldName} must be 500 characters or less`;
  }

  return null;
}

module.exports = {
  parsePositiveInt,
  validateMode,
  validatePromptText
};

