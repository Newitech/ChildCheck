import bcrypt from "bcryptjs";

/**
 * Password & PIN helpers (bcrypt).
 *
 * Passwords use 10 rounds; PINs use 8 rounds (4–6 digit input space is small
 * so a lower cost is acceptable for kiosk speed while still being non-trivial).
 */

const PASSWORD_ROUNDS = 10;
const PIN_ROUNDS = 8;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_ROUNDS);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/** True when the input is 4–6 ASCII digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin ?? "");
}
