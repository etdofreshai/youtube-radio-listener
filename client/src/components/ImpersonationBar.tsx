/**
 * ImpersonationBar — fixed orange banner shown when an admin is impersonating another user.
 *
 * Displays the impersonated user's name and a button to return to the original admin context.
 * Rendered at the top of the page above all other content.
 */

import { useAuth } from '../context/AuthContext';

export default function ImpersonationBar() {
  const { isImpersonating, impersonatedUser, currentUser, returnToOriginalUser } = useAuth();

  if (!isImpersonating || !impersonatedUser) return null;

  const impersonatedName = impersonatedUser.displayName ?? impersonatedUser.username;
  const adminName = currentUser?.displayName ?? currentUser?.username ?? 'admin';

  return (
    <div className="impersonation-bar">
      <span className="impersonation-bar-label">
        👤 Impersonating <strong>{impersonatedName}</strong>
      </span>
      <button
        className="impersonation-bar-return"
        onClick={returnToOriginalUser}
      >
        ↩ Return to {adminName}
      </button>
    </div>
  );
}
