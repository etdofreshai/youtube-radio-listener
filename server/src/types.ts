export interface Track {
  id: string;
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number; // 0-100
  notes: string;
  createdAt: string;
  updatedAt: string;
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
