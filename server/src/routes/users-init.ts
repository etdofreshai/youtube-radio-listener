/**
 * User initialization utilities.
 * Ensures protected users exist and are configured correctly.
 *
 * Protected user: username='etdofresh' (any username matching /^etdofresh/i is protected).
 * This user cannot be deleted or renamed via the API.
 */

import { getPool } from '../db/pool';

/** Fixed UUID for the protected 'etdofresh' user — stable across restarts */
export const ETDOFRESH_USER_ID = '00000000-0000-0000-0000-etdofresh0001';

/**
 * Ensure the protected 'etdofresh' user exists in the database.
 * Called at startup to guarantee the default admin user is available.
 *
 * Dev note: If DATABASE_URL is not set (in-memory mode), this is a no-op.
 */
export async function ensureProtectedUser(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    // In-memory mode — nothing to do
    return;
  }

  try {
    // 1. Ensure the etdofresh user exists
    const result = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      ['etdofresh']
    );

    if (result.rows.length === 0) {
      // Use ON CONFLICT to handle race conditions / duplicate id/username
      await pool.query(
        `INSERT INTO users (id, username, display_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING`,
        [ETDOFRESH_USER_ID, 'etdofresh', 'ET (do fresh)', 'admin']
      );
      console.log('   ✅ Seeded protected user: etdofresh');
    } else {
      // Make sure the role is admin regardless
      await pool.query(
        `UPDATE users SET role = 'admin' WHERE username = $1 AND role != 'admin'`,
        ['etdofresh']
      );
    }
  } catch (err) {
    // UUID format may fail on some pg versions — try without the fixed ID
    try {
      await pool.query(
        `INSERT INTO users (username, display_name, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (username) DO NOTHING`,
        ['etdofresh', 'ET (do fresh)', 'admin']
      );
      console.log('   ✅ Seeded protected user: etdofresh (auto-generated ID)');
    } catch (innerErr) {
      console.error('Failed to ensure etdofresh user:', innerErr);
      // Don't throw — startup shouldn't fail over this
    }
  }
}
