/**
 * Phone number formatting utilities
 * Format: (XXX) XXX-XXXX
 */

/**
 * Format a phone number string to (XXX) XXX-XXXX format
 * @param value - Raw phone number (can contain any characters)
 * @returns Formatted phone number string
 */
export const formatPhoneNumber = (value: string | null | undefined): string => {
  if (!value) return '';

  // Strip all non-digits
  const digits = value.replace(/\D/g, '');

  // Format based on length
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

/**
 * Extract just digits from a phone number (for storage)
 * @param value - Phone number string (formatted or not)
 * @returns Just the digits, max 10
 */
export const getPhoneDigits = (value: string): string => {
  return value.replace(/\D/g, '').slice(0, 10);
};

/**
 * Check if a phone number has all 10 digits
 * @param value - Phone number string
 * @returns true if complete
 */
export const isPhoneComplete = (value: string | null | undefined): boolean => {
  if (!value) return false;
  return value.replace(/\D/g, '').length === 10;
};
