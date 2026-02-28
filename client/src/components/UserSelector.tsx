/**
 * UserSelector — identity picker shown after the password gate passes.
 *
 * Lists all users from /api/users. The user clicks their name to select it.
 * Selection is persisted in localStorage (key: nightwave_user_id) via setCurrentUser.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { User } from '../api';
import { getUsers } from '../api';

export default function UserSelector() {
  const { setCurrentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch(() => setError('Could not load users. Is the server running?'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="gate-overlay">
      <div className="gate-modal">
        <div className="gate-logo">👤</div>
        <h1 className="gate-title">Who are you?</h1>
        <p className="gate-subtitle">Select your identity to continue</p>

        {loading && <p className="gate-subtitle">Loading users…</p>}
        {error && <p className="gate-error">{error}</p>}

        {!loading && !error && (
          <ul className="user-select-list">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  className="user-select-btn"
                  onClick={() => setCurrentUser(user)}
                >
                  <span className="user-select-avatar">
                    {user.displayName?.[0]?.toUpperCase() ??
                      user.username[0].toUpperCase()}
                  </span>
                  <span className="user-select-name">
                    {user.displayName ?? user.username}
                  </span>
                  <span className="user-select-handle">@{user.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
