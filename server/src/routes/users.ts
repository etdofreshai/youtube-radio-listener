/**
 * Users API routes.
 * Provides CRUD for user management.
 * The 'etdofresh*' user (matching /^etdofresh.*$/) is protected and cannot be deleted or renamed.
 */

import { Router, Request, Response } from 'express';
import { getPool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/** Protected username pattern — any username starting with 'etdofresh' */
export const PROTECTED_PATTERN = /^etdofresh.*$/i;

/** Check if a username is protected */
export function isProtectedUsername(username: string): boolean {
  return PROTECTED_PATTERN.test(username);
}

// User type
export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
}

// Input types
export interface CreateUserInput {
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role?: string;
}

export interface UpdateUserInput {
  username?: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  role?: string;
}

// GET /api/users — list all users
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT id, username, display_name, email, avatar_url, role, created_at, updated_at
      FROM users
      ORDER BY created_at ASC
    `);
    const users: User[] = result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    res.json(users);
  } catch (err) {
    console.error('[users] Error listing users:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/users/:id — get a user by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const result = await pool.query(`
      SELECT id, username, display_name, email, avatar_url, role, created_at, updated_at
      FROM users WHERE id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = result.rows[0];
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    res.json(user);
  } catch (err) {
    console.error('[users] Error getting user:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/users — create a new user
router.post('/', async (req: Request, res: Response) => {
  try {
    const { username, displayName, email, avatarUrl, role } = req.body as CreateUserInput;
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const trimmedUsername = username.trim();
    const id = uuidv4();
    const pool = getPool();

    const result = await pool.query(`
      INSERT INTO users (id, username, display_name, email, avatar_url, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, display_name, email, avatar_url, role, created_at, updated_at
    `, [id, trimmedUsername, displayName || null, email || null, avatarUrl || null, role || 'user']);

    const row = result.rows[0];
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    res.status(201).json(user);
  } catch (err: any) {
    console.error('[users] Error creating user:', err);
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id — update a user
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { username, displayName, email, avatarUrl, role } = req.body as UpdateUserInput;

    const pool = getPool();

    // Fetch existing user to check protected status
    const existingResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = existingResult.rows[0];

    // Check if trying to rename a protected user
    if (isProtectedUsername(existingUser.username) && username && username !== existingUser.username) {
      return res.status(403).json({ error: 'Cannot rename protected user' });
    }

    // Check if new username conflicts with protected pattern for non-protected users
    if (username && !isProtectedUsername(existingUser.username) && isProtectedUsername(username)) {
      return res.status(400).json({ error: 'Cannot use protected username pattern' });
    }

    const result = await pool.query(`
      UPDATE users
      SET username = COALESCE($2, username),
          display_name = $3,
          email = $4,
          avatar_url = $5,
          role = COALESCE($6, role),
          updated_at = now()
      WHERE id = $1
      RETURNING id, username, display_name, email, avatar_url, role, created_at, updated_at
    `, [id, username?.trim() || null, displayName ?? existingUser.display_name, email ?? existingUser.email, avatarUrl ?? existingUser.avatar_url, role || null]);

    const row = result.rows[0];
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    res.json(user);
  } catch (err: any) {
    console.error('[users] Error updating user:', err);
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — delete a user
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Fetch existing user to check protected status
    const existingResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingUser = existingResult.rows[0];

    // Prevent deletion of protected user
    if (isProtectedUsername(existingUser.username)) {
      return res.status(403).json({ error: 'Cannot delete protected user' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('[users] Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
