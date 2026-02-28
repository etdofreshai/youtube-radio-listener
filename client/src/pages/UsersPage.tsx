/**
 * UsersPage — CRUD management for user accounts.
 *
 * Protected constraint:
 *   - Any user whose username matches /^etdofresh/i (e.g. 'etdofresh', 'etdofresh_alt')
 *     cannot be deleted or have their username changed.
 *   - The delete button and username field are disabled for protected users.
 *
 * All operations call the /api/users REST endpoints.
 */

import { useEffect, useState, FormEvent } from 'react';
import type { User, CreateUserInput, UpdateUserInput } from '../api';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  isProtectedUsername,
} from '../api';
import { useAuth } from '../context/AuthContext';

interface EditState {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
}

export default function UsersPage() {
  const { currentUser, impersonateUser, isImpersonating, impersonatedUserId, originalUserId } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The "real" current user is the original admin when impersonating, otherwise currentUser
  const realUserId = isImpersonating ? originalUserId : currentUser?.id;
  const isAdmin = currentUser?.role === 'admin';

  // Create form state
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit state
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await getUsers();
      setUsers(data);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newUsername.trim()) return;

    if (isProtectedUsername(newUsername.trim())) {
      setCreateError('Cannot create a user with a protected username (etdofresh*).');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      const input: CreateUserInput = {
        username: newUsername.trim(),
        displayName: newDisplayName.trim() || undefined,
        email: newEmail.trim() || undefined,
        role: newRole || 'user',
      };
      const created = await createUser(input);
      setUsers((prev) => [...prev, created]);
      setNewUsername('');
      setNewDisplayName('');
      setNewEmail('');
      setNewRole('user');
    } catch (err: any) {
      setCreateError(err.message ?? 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(user: User) {
    setEditing({
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? '',
      email: user.email ?? '',
      role: user.role,
    });
    setEditError('');
  }

  function cancelEdit() {
    setEditing(null);
    setEditError('');
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;

    const original = users.find((u) => u.id === editing.id);
    if (!original) return;

    // Protected users cannot be renamed
    if (
      isProtectedUsername(original.username) &&
      editing.username !== original.username
    ) {
      setEditError('Cannot rename a protected user (etdofresh*).');
      return;
    }

    // Non-protected users cannot take a protected username
    if (
      !isProtectedUsername(original.username) &&
      isProtectedUsername(editing.username)
    ) {
      setEditError('Cannot use a protected username pattern (etdofresh*).');
      return;
    }

    setSaving(true);
    setEditError('');
    try {
      const input: UpdateUserInput = {
        username: editing.username.trim() || undefined,
        displayName: editing.displayName.trim() || null,
        email: editing.email.trim() || null,
        role: editing.role || undefined,
      };
      // Don't send username if it hasn't changed (avoid needless unique check)
      if (editing.username === original.username) {
        delete input.username;
      }
      const updated = await updateUser(editing.id, input);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditing(null);
    } catch (err: any) {
      setEditError(err.message ?? 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: User) {
    if (isProtectedUsername(user.username)) return; // guard

    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;

    try {
      await deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      if (editing?.id === user.id) setEditing(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete user.');
    }
  }

  return (
    <div className="page-container">
      <h2>👥 Users</h2>

      {/* Create new user */}
      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h3>Add user</h3>
        <form onSubmit={handleCreate} className="user-form">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username *"
            required
          />
          <input
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            placeholder="Display name"
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email"
          />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" disabled={creating || !newUsername.trim()}>
            {creating ? 'Adding…' : 'Add user'}
          </button>
        </form>
        {createError && <p className="form-error">{createError}</p>}
      </section>

      {/* User list */}
      {loading && <p>Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && users.length === 0 && <p className="muted">No users yet.</p>}

      <ul className="user-list">
        {users.map((user) => {
          const isProtected = isProtectedUsername(user.username);
          const isEditing = editing?.id === user.id;

          return (
            <li key={user.id} className={`user-item${isProtected ? ' user-protected' : ''}`}>
              {isEditing ? (
                <form onSubmit={handleSave} className="user-edit-form">
                  <input
                    value={editing.username}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, username: e.target.value })
                    }
                    placeholder="Username *"
                    required
                    disabled={isProtected}
                    title={isProtected ? 'Protected username cannot be changed' : undefined}
                  />
                  <input
                    value={editing.displayName}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, displayName: e.target.value })
                    }
                    placeholder="Display name"
                  />
                  <input
                    type="email"
                    value={editing.email}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, email: e.target.value })
                    }
                    placeholder="Email"
                  />
                  <select
                    value={editing.role}
                    onChange={(e) =>
                      setEditing((s) => s && { ...s, role: e.target.value })
                    }
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                  {editError && <p className="form-error">{editError}</p>}
                  <div className="user-edit-actions">
                    <button type="submit" disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="user-item-content">
                  <span className="user-avatar">
                    {(user.displayName ?? user.username)[0].toUpperCase()}
                  </span>
                  <div className="user-details">
                    <strong>{user.displayName ?? user.username}</strong>
                    {' '}
                    <span className="muted">@{user.username}</span>
                    {isProtected && (
                      <span
                        className="badge badge-protected"
                        title="This user is protected and cannot be deleted or renamed"
                      >
                        🔒 protected
                      </span>
                    )}
                    <div className="user-meta">
                      <span className={`badge badge-role badge-${user.role}`}>
                        {user.role}
                      </span>
                      {user.email && (
                        <span className="muted">{user.email}</span>
                      )}
                    </div>
                  </div>
                  <div className="user-actions">
                    {isAdmin && (
                      <button
                        onClick={() => impersonateUser(user.id)}
                        disabled={user.id === realUserId}
                        title={
                          user.id === realUserId
                            ? 'Cannot impersonate yourself'
                            : `Impersonate ${user.displayName ?? user.username}`
                        }
                        className="btn-impersonate"
                      >
                        🎭 Impersonate
                      </button>
                    )}
                    <button onClick={() => startEdit(user)}>Edit</button>
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={isProtected}
                      title={
                        isProtected
                          ? 'Protected user cannot be deleted'
                          : 'Delete user'
                      }
                      className="btn-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
