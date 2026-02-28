/**
 * PasswordGate — blocks app access until the correct password is entered.
 *
 * Dev bypass:
 *   - If no APP_PASSWORD is set on the server, /api/auth/status returns
 *     { requiresPassword: false } and this gate is never shown.
 *   - To test the gate locally, set APP_PASSWORD=secret in server/.env
 */

import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { verifyPassword } from '../api';

export default function PasswordGate() {
  const { setPasswordVerified } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verifyPassword(password);
      if (result.valid) {
        setPasswordVerified(true);
      } else {
        setError('Incorrect password. Please try again.');
        setPassword('');
      }
    } catch {
      setError('Could not reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gate-overlay">
      <div className="gate-modal">
        <div className="gate-logo">🌊</div>
        <h1 className="gate-title">Nightwave</h1>
        <p className="gate-subtitle">Enter the app password to continue</p>
        <form onSubmit={handleSubmit} className="gate-form">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            disabled={loading}
            className="gate-input"
            aria-label="Password"
          />
          {error && <p className="gate-error">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="gate-submit"
          >
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
