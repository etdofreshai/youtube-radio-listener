import { Routes, Route, NavLink } from 'react-router-dom';
import TracksPage from './pages/TracksPage';
import PlaylistsPage from './pages/PlaylistsPage';
import PlaylistEditorPage from './pages/PlaylistEditorPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import SessionsPage from './pages/SessionsPage';
import SessionPage from './pages/SessionPage';
import NowPlayingPage from './pages/NowPlayingPage';
import { AudioPlayerProvider, PlayerBar } from './components/AudioPlayer';

function App() {
  return (
    <AudioPlayerProvider>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-logo">🌊 Nightwave</div>
          <nav className="sidebar-nav">
            <NavLink to="/now-playing" className={({ isActive }) => isActive ? 'active' : ''}>
              🎶 Now Playing
            </NavLink>
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              🎵 Tracks
            </NavLink>
            <NavLink to="/playlists" className={({ isActive }) => isActive ? 'active' : ''}>
              📋 Playlists
            </NavLink>
            <NavLink to="/favorites" className={({ isActive }) => isActive ? 'active' : ''}>
              ❤️ Favorites
            </NavLink>
            <NavLink to="/sessions" className={({ isActive }) => isActive ? 'active' : ''}>
              🎧 Sessions
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => isActive ? 'active' : ''}>
              📜 History
            </NavLink>
          </nav>
        </aside>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<TracksPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/:id" element={<PlaylistEditorPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/session/:token" element={<SessionPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/now-playing" element={<NowPlayingPage />} />
          </Routes>
        </main>
        <PlayerBar />
      </div>
    </AudioPlayerProvider>
  );
}

export default App;
