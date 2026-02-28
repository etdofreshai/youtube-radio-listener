import { Routes, Route, NavLink } from 'react-router-dom';
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
import { AudioPlayerProvider, PlayerBar } from './components/AudioPlayer';

function App() {
  return (
    <AudioPlayerProvider>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-logo">🌊 Nightwave</div>
          <nav className="sidebar-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
              🎵 Tracks
            </NavLink>
            <NavLink to="/artists" className={({ isActive }) => isActive ? 'active' : ''}>
              🎤 Artists
            </NavLink>
            <NavLink to="/albums" className={({ isActive }) => isActive ? 'active' : ''}>
              💿 Albums
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
          </Routes>
        </main>
        <PlayerBar />
      </div>
    </AudioPlayerProvider>
  );
}

export default App;
