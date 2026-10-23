// Normalize untrusted provider text (status descriptions, messages) into a
// bounded, single-line plain string before it is stored, shown publicly, or
// sent anywhere. Non-strings become ''.

export const MAX_STATUS_MESSAGE_LENGTH = 500;

// C0/C1 control characters and Unicode bidi overrides/isolates.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g;

export function cleanStatusText(value: unknown, maxLength = MAX_STATUS_MESSAGE_LENGTH): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
