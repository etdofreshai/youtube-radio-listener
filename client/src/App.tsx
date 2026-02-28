import { Routes, Route, NavLink } from 'react-router-dom';
import TracksPage from './pages/TracksPage';
import PlaylistsPage from './pages/PlaylistsPage';
import FavoritesPage from './pages/FavoritesPage';

function App() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">🌊 Nightwave</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
            🎵 Tracks
          </NavLink>
          <NavLink to="/playlists" className={({ isActive }) => isActive ? 'active' : ''}>
            📋 Playlists
          </NavLink>
          <NavLink to="/favorites" className={({ isActive }) => isActive ? 'active' : ''}>
            ❤️ Favorites
          </NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<TracksPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
