export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

export interface Track {
  id: string;
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number; // 0-200 (percentage; >100 = amplification via gain)
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Audio pipeline fields
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;  // filename in audio/ dir
  duration: number | null;       // seconds
  lastDownloadAt: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Favorite {
  id: string;
  trackId: string;
  likedAt: string;
}

export interface CreateTrackInput {
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
}

export interface UpdateTrackInput {
  youtubeUrl?: string;
  title?: string;
  artist?: string;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  trackIds?: string[];
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  trackIds?: string[];
}
