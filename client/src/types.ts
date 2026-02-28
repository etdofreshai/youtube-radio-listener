export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

export interface Track {
  id: string;
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number; // 0-200 (percentage; >100 = amplification)
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Audio pipeline fields
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;
  duration: number | null;
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
  track?: Track | null;
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
