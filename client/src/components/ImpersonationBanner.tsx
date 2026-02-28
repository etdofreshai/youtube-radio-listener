/**
 * ImpersonationBanner — orange banner shown at top of page when an admin
 * is impersonating another user.
 *
 * Displays the impersonated user's name and a "Return to [admin]" button.
 * Visible across all pages — rendered in the top-level App shell.
 */

import { useAuth } from '../context/AuthContext';

export default function ImpersonationBanner() {
  const {
    isImpersonating,
    impersonatedUser,
    currentUser,
    returnToOriginalUser,
  } = useAuth();

  if (!isImpersonating || !impersonatedUser) return null;

  const adminName = currentUser?.displayName ?? currentUser?.username ?? 'admin';
  const targetName = impersonatedUser.displayName ?? impersonatedUser.username;

  return (
    <div className="impersonation-banner" role="alert">
      <span className="impersonation-banner-text">
        🔶 You are impersonating <strong>{targetName}</strong>. Your actions are recorded as this user.
      </span>
      <button
        className="impersonation-banner-btn"
        onClick={returnToOriginalUser}
      >
        Return to {adminName}
      </button>
    </div>
  );
}
