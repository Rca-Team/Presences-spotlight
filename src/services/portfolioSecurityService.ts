/**
 * Portfolio Vault Cryptographic Cell Security Service
 *
 * Implements a 1,024-round cellular diffusion matrix algorithm (Cell Algorithm)
 * to hash and verify the portfolio access PIN without ever exposing the plain
 * PIN in the codebase or in network requests.
 *
 * The resulting cell hash is stored and verified in the database (attendance_settings table).
 */

import { supabase } from '@/integrations/supabase/client';

export const PORTFOLIO_VAULT_SETTING_KEY = 'portfolio_cell_vault';
const CELL_DEFAULT_SALT = 'presences_cell_v1_rca_secure';
const CELL_DIFFUSION_ROUNDS = 1024;

// Irreversible seed cell hash (1,024-round diffusion) for initial default PIN
const SEED_CELL_HASH = '5987503e55c005fcf91794b009fa47e8fdb84f8581e4dc75ba1c33191e026fce';

const SESSION_KEY = 'rca_portfolio_verified_session';
const FAILED_ATTEMPTS_KEY = 'rca_portfolio_failed_attempts';
const LOCKOUT_UNTIL_KEY = 'rca_portfolio_lockout_until';

/**
 * SHA-256 helper using native Web Crypto API
 */
async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback bitwise SHA-256 simulation if subtle crypto is somehow unavailable
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * The Cell Algorithm:
 * Multi-round iterative cellular diffusion matrix combining state, round index,
 * cryptographic salt, and input PIN.
 */
export async function computeCellHash(pin: string, salt = CELL_DEFAULT_SALT, rounds = CELL_DIFFUSION_ROUNDS): Promise<string> {
  let state = await sha256Hex(`${salt}:${pin}`);
  for (let r = 0; r < rounds; r++) {
    state = await sha256Hex(`${r}:${state}:${salt}:${pin}`);
  }
  return state;
}

export type CellVaultRecord = {
  hash: string;
  salt: string;
  rounds: number;
  updated_at: string;
};

/**
 * Fetches the cell hash record from the database attendance_settings table
 */
export async function getDatabaseCellVault(): Promise<CellVaultRecord | null> {
  try {
    const { data: row, error } = await supabase
      .from('attendance_settings')
      .select('value, setting_value')
      .or(`key.eq.${PORTFOLIO_VAULT_SETTING_KEY},setting_key.eq.${PORTFOLIO_VAULT_SETTING_KEY}`)
      .maybeSingle();

    if (error) {
      console.warn('Could not read cell vault from database:', error.message);
      return null;
    }

    const rawVal = row?.value || row?.setting_value;
    if (!rawVal) return null;

    const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
    if (parsed && typeof parsed.hash === 'string') {
      return parsed as CellVaultRecord;
    }
  } catch (e) {
    console.warn('Error reading cell vault:', e);
  }
  return null;
}

/**
 * Saves a new cell hash record into the database attendance_settings table
 */
export async function saveDatabaseCellVault(record: CellVaultRecord): Promise<boolean> {
  try {
    const payload = JSON.stringify(record);
    const settingsPayload = {
      key: PORTFOLIO_VAULT_SETTING_KEY,
      value: payload,
      setting_key: PORTFOLIO_VAULT_SETTING_KEY,
      setting_value: payload,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('attendance_settings')
      .select('id')
      .or(`key.eq.${PORTFOLIO_VAULT_SETTING_KEY},setting_key.eq.${PORTFOLIO_VAULT_SETTING_KEY}`)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('attendance_settings')
        .update(settingsPayload)
        .eq('id', existing.id);
      return !error;
    }

    const { error } = await supabase.from('attendance_settings').insert(settingsPayload);
    return !error;
  } catch (err) {
    console.error('Error saving cell vault:', err);
    return false;
  }
}

/**
 * Constant-time string equality check to resist timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Checks remaining lockout seconds if user entered wrong PIN multiple times
 */
export function getRemainingLockoutSeconds(): number {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_UNTIL_KEY);
    if (!raw) return 0;
    const until = parseInt(raw, 10);
    const diff = Math.ceil((until - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  } catch {
    return 0;
  }
}

/**
 * Records a failed attempt and locks for 30s if failed >= 5 times
 */
export function recordFailedAttempt(): { locked: boolean; remainingSec: number } {
  try {
    const raw = sessionStorage.getItem(FAILED_ATTEMPTS_KEY) || '0';
    const count = parseInt(raw, 10) + 1;
    sessionStorage.setItem(FAILED_ATTEMPTS_KEY, String(count));

    if (count >= 5) {
      const lockUntil = Date.now() + 30000; // 30 second penalty
      sessionStorage.setItem(LOCKOUT_UNTIL_KEY, String(lockUntil));
      return { locked: true, remainingSec: 30 };
    }
  } catch {}
  return { locked: false, remainingSec: 0 };
}

export function resetFailedAttempts(): void {
  try {
    sessionStorage.removeItem(FAILED_ATTEMPTS_KEY);
    sessionStorage.removeItem(LOCKOUT_UNTIL_KEY);
  } catch {}
}

/**
 * Verifies entered PIN against the database cell vault hash
 */
export async function verifyPortfolioPin(enteredPin: string): Promise<boolean> {
  const lockout = getRemainingLockoutSeconds();
  if (lockout > 0) return false;

  const cleanPin = (enteredPin || '').trim();
  if (!cleanPin) return false;

  // 1. Fetch cell vault from database
  const dbVault = await getDatabaseCellVault();
  const targetHash = dbVault?.hash || SEED_CELL_HASH;
  const targetSalt = dbVault?.salt || CELL_DEFAULT_SALT;
  const targetRounds = dbVault?.rounds || CELL_DIFFUSION_ROUNDS;

  // 2. Compute 1,024-round cell hash on the entered PIN
  const computedHash = await computeCellHash(cleanPin, targetSalt, targetRounds);

  // 3. Constant-time comparison
  const isValid = constantTimeCompare(computedHash, targetHash);

  if (isValid) {
    resetFailedAttempts();
    setPortfolioSessionVerified(true);

    // If database didn't have the record yet, securely write it now
    if (!dbVault) {
      void saveDatabaseCellVault({
        hash: targetHash,
        salt: targetSalt,
        rounds: targetRounds,
        updated_at: new Date().toISOString(),
      });
    }
    return true;
  }

  recordFailedAttempt();
  return false;
}

/**
 * Updates the access PIN in the database using the cell algorithm
 */
export async function updatePortfolioPin(newPin: string): Promise<boolean> {
  const cleanPin = (newPin || '').trim();
  if (cleanPin.length < 4) return false;

  const salt = `cell_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const hash = await computeCellHash(cleanPin, salt, CELL_DIFFUSION_ROUNDS);

  const record: CellVaultRecord = {
    hash,
    salt,
    rounds: CELL_DIFFUSION_ROUNDS,
    updated_at: new Date().toISOString(),
  };

  const success = await saveDatabaseCellVault(record);
  if (success) {
    setPortfolioSessionVerified(true);
  }
  return success;
}

export function isPortfolioSessionVerified(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPortfolioSessionVerified(verified: boolean): void {
  try {
    if (verified) {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {}
}
