// VERSIONS Shared Types - TypeScript definitions mirroring Rust API structs
// DRY: Single source of truth for data structures across TUI and Web
// CLEAN: Explicit types for better development experience

// Core API Response Structure
// Mirrors: server/src/rest_api.rs ApiResponse<T>
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// Version Information
// Mirrors: server/src/rest_api.rs VersionInfo
export interface VersionInfo {
  id: string;
  title: string;
  artist: string;
  version_type: VersionType;
  duration?: number;
  file_size?: number;
  upload_date: string;
  play_count: number;
  vote_score: number;
}

// Song with Multiple Versions  
// Mirrors: server/src/rest_api.rs Song
export interface Song {
  id: string;
  canonical_title: string;
  versions: VersionInfo[];
  total_versions: number;
}

// Version Types - Based on VERSIONS concept
export type VersionType = 
  | 'Demo'
  | 'Studio' 
  | 'Live'
  | 'Remix'
  | 'Remaster'
  | 'Acoustic'
  | 'Cover'
  | 'Instrumental';

// Audio Metadata
// Mirrors: server/src/audio_service.rs AudioMetadata
export interface AudioMetadata {
  file_path: string;
  title?: string;
  artist?: string;
  album?: string;
  duration_seconds?: number;
  file_size: number;
  format: AudioFormat;
  sample_rate?: number;
  channels?: number;
  bitrate?: number;
}

// Supported Audio Formats
export type AudioFormat = 'mp3' | 'flac' | 'wav' | 'm4a' | 'ogg' | 'aiff';

// Audio Stream Response
export interface AudioStream {
  content: Uint8Array;
  content_type: string;
  content_length: number;
  accept_ranges: boolean;
}

// Range Request for Audio Streaming
export interface RangeRequest {
  start: number;
  end?: number;
}

// Farcaster Integration Types
// Mirrors: server/src/farcaster_service.rs structures

export interface FarcasterUser {
  fid: number;
  username: string;
  display_name?: string;
  bio?: string;
  pfp_url?: string;
  follower_count?: number;
  following_count?: number;
}

export interface FarcasterCast {
  hash: string;
  author_fid: number;
  text: string;
  timestamp: string;
  replies_count: number;
  reactions_count: number;
  embeds?: string[];
}

export interface SocialRecommendation {
  version_id: string;
  title: string;
  artist: string;
  version_type: VersionType;
  recommended_by_fid: number;
  recommended_by_username: string;
  reason: string;
  score: number;
}

// Query Parameters
export interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface FarcasterQuery {
  fid: number;
}

// Upload Request Types
export interface AudioUploadRequest {
  file_id: string;
  content: string; // base64 encoded
  format: AudioFormat;
}

export interface CastRequest {
  text: string;
  embed_url?: string;
}

// Filecoin Integration Types (for future development)
export interface FilecoinStorageInfo {
  piece_cid: string;
  storage_cost: string;
  retrieval_cost: string;
  provider_count: number;
}

export interface FilecoinUploadRequest {
  file_id: string;
  metadata: AudioMetadata;
  storage_duration: number; // in days
}

export interface CreatorPaymentRequest {
  creator_address: string;
  amount_usd: number;
  message?: string;
}

export interface PaymentRail {
  rail_id: string;
  creator_address: string;
  fan_address: string;
  status: PaymentRailStatus;
}

export type PaymentRailStatus = 'active' | 'inactive' | 'suspended';

export interface NetworkStatus {
  network: string;
  storage_cost_per_gb: string;
  retrieval_cost_per_gb: string;
  average_deal_time: string;
  active_storage_providers: number;
  total_network_capacity: string;
}

// Client-side specific types (not in Rust backend)
export interface ClientConfig {
  environment: 'development' | 'netlify' | 'production';
  domain: string;
  apiBase: string;
  manifestUrl: string;
}

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTrack?: VersionInfo;
  currentTime: number;
  duration: number;
  volume: number;
}

export interface TemplateData {
  [key: string]: string | number | boolean;
}

export interface ComponentOptions {
  data?: TemplateData;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  lazy?: boolean;
  forceReload?: boolean;
}

// Theme System Types
export interface ThemeColors {
  primary: {
    background: string;
    foreground: string;
  };
  normal: Record<string, string>;
  bright: Record<string, string>;
  accent: Record<string, string>;
}

// TUI Integration Types
// These help bridge TUI concepts to web
export interface TUIState {
  currentView: 'library' | 'playlist' | 'search' | 'config';
  focusedComponent: string;
  playbackStatus: 'playing' | 'paused' | 'stopped';
}

export interface KeyBinding {
  key: string;
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  action: string;
  description: string;
}

// Error Types for better error handling
export interface APIError extends Error {
  status?: number;
  code?: string;
  details?: Record<string, any>;
}

export interface ValidationError extends Error {
  field: string;
  value: any;
  constraint: string;
}

// Type Guards for Runtime Type Checking
export function isApiResponse<T>(obj: any): obj is ApiResponse<T> {
  return obj && typeof obj.success === 'boolean';
}

export function isVersionInfo(obj: any): obj is VersionInfo {
  return obj && 
         typeof obj.id === 'string' &&
         typeof obj.title === 'string' &&
         typeof obj.artist === 'string' &&
         typeof obj.version_type === 'string';
}

export function isFarcasterUser(obj: any): obj is FarcasterUser {
  return obj && 
         typeof obj.fid === 'number' &&
         typeof obj.username === 'string';
}

// Utility types for better development experience
export type Partial<T> = {
  [P in keyof T]?: T[P];
};

export type Required<T> = {
  [P in keyof T]-?: T[P];
};

export type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

// ENHANCEMENT FIRST: Helper types for working with API responses
export type APIResponseData<T> = T extends ApiResponse<infer U> ? U : never;

export type VersionWithAudio = VersionInfo & {
  audioMetadata?: AudioMetadata;
  isLoaded?: boolean;
};

export type SongWithPlayback = Song & {
  currentVersion?: VersionWithAudio;
  isPlaying?: boolean;
};

// MODULAR: All types are already exported above individually
