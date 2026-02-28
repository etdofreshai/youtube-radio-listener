import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useAudioPlayer } from './components/AudioPlayer';
import TracksPage from './pages/TracksPage';
import NowPlayingPage from './pages/NowPlayingPage';
import PlaylistsPage from './pages/PlaylistsPage';
import PlaylistEditorPage from './pages/PlaylistEditorPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import SessionsPage from './pages/SessionsPage';
import SessionPage from './pages/SessionPage';
import ArtistsPage from './pages/ArtistsPage';
import ArtistPage from './pages/ArtistPage';
import AlbumsPage from './pages/AlbumsPage';
import AlbumPage from './pages/AlbumPage';
import RadiosPage from './pages/RadiosPage';
import UsersPage from './pages/UsersPage';
import { AudioPlayerProvider, PlayerBar } from './components/AudioPlayer';
import PasswordGate from './components/PasswordGate';
import UserSelector from './components/UserSelector';
import ImpersonationBanner from './components/ImpersonationBanner';
import { useAuth } from './context/AuthContext';

/** Sidebar "Now Playing" link — only rendered when a track/radio is active. */
function NowPlayingNavLink({ onNavigate }: { onNavigate?: () => void }) {
  const { currentTrack, currentRadio } = useAudioPlayer();
  if (!currentTrack && !currentRadio) return null;
  return (
    <NavLink to="/now-playing" onClick={onNavigate} className={({ isActive }) => isActive ? 'active now-playing-nav-link' : 'now-playing-nav-link'}>
      ▶️ Now Playing
    </NavLink>
  );
}

function AppShell() {
  const { passwordVerified, loading, currentUser, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile navigation)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Show nothing while we determine auth status (avoids flash)
  if (loading) {
    return (
      <div className="gate-overlay">
        <div className="gate-modal">
          <div className="gate-logo">🌊</div>
          <p className="gate-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  // Password gate — must pass before anything else
  if (!passwordVerified) {
    return <PasswordGate />;
  }

  // User selection — must pick identity after password
  if (!currentUser) {
    return <UserSelector />;
  }

  return (
    <AudioPlayerProvider>
      <ImpersonationBanner />
      <div className="app-layout">
        {/* Mobile header with hamburger */}
        <header className="mobile-header">
          <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Toggle menu">
            <span className={`hamburger-icon ${sidebarOpen ? 'open' : ''}`}>
              <span /><span /><span />
            </span>
          </button>
          <span className="mobile-header-title">🌊 Nightwave</span>
        </header>

        {/* Overlay backdrop for mobile sidebar */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-logo">🌊 Nightwave</div>
          <nav className="sidebar-nav">
            <NowPlayingNavLink onNavigate={closeSidebar} />
            <NavLink to="/" end onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              🎵 Tracks
            </NavLink>
            <NavLink to="/artists" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              🎤 Artists
            </NavLink>
            <NavLink to="/albums" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              💿 Albums
            </NavLink>
            <NavLink to="/playlists" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              📋 Playlists
            </NavLink>
            <NavLink to="/favorites" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              ❤️ Favorites
            </NavLink>
            <NavLink to="/sessions" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              🎧 Sessions
            </NavLink>
            <NavLink to="/history" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              📜 History
            </NavLink>
            <NavLink to="/radios" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              📻 Radios
            </NavLink>
            <NavLink to="/users" onClick={closeSidebar} className={({ isActive }) => isActive ? 'active' : ''}>
              👥 Users
            </NavLink>
          </nav>

          {/* Current user indicator */}
          <div className="sidebar-user">
            <span className="sidebar-user-avatar">
              {(currentUser.displayName ?? currentUser.username)[0].toUpperCase()}
            </span>
            <span className="sidebar-user-name">
              {currentUser.displayName ?? currentUser.username}
            </span>
            <button
              className="sidebar-user-logout"
              onClick={logout}
              title="Switch user"
            >
              ↩
            </button>
          </div>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<TracksPage />} />
            <Route path="/now-playing" element={<NowPlayingPage />} />
            <Route path="/artists" element={<ArtistsPage />} />
            <Route path="/artists/:idOrSlug" element={<ArtistPage />} />
            <Route path="/albums" element={<AlbumsPage />} />
            <Route path="/albums/:idOrSlug" element={<AlbumPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/:id" element={<PlaylistEditorPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/session/:token" element={<SessionPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/radios" element={<RadiosPage />} />
            <Route path="/users" element={<UsersPage />} />
          </Routes>
        </main>
        <PlayerBar />
      </div>
    </AudioPlayerProvider>
  );
}

function App() {
  return <AppShell />;
}

export default App;
