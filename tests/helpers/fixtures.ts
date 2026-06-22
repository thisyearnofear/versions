// MODULAR: row factories for tests. Fixed UUIDs keep assertions stable.

export const TEST_IDS = {
  user: '00000000-0000-0000-0000-000000000001',
  artist: '00000000-0000-0000-0000-000000000002',
  submission: '00000000-0000-0000-0000-000000000003',
  submission2: '00000000-0000-0000-0000-000000000004',
  submission3: '00000000-0000-0000-0000-000000000005',
  rating: '00000000-0000-0000-0000-000000000010',
  claim: '00000000-0000-0000-0000-000000000011',
  playlist: '00000000-0000-0000-0000-000000000020',
  curatorWallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  curatorWallet2: '0x3C44CdDdB6a900fA2b585dd299e03d12FA4293BC',
  curatorWallet3: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  artistWallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
};

export const TEST_PLATFORM_WALLET = '0x' + 'a'.repeat(40);

export function mkSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.submission,
    artistWallet: TEST_IDS.artistWallet,
    audiusTrackId: null,
    musicbrainzId: null,
    title: 'Test Track',
    artistName: 'Test Artist',
    versionType: 'demo' as const,
    genre: 'rock',
    artistMood: 'energetic',
    description: 'A test track',
    audioPath: 'data/uploads/test.mp3',
    audioDurationSeconds: 180,
    audioSizeBytes: 1024,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    coverSvg: null,
    status: 'pending_payment' as const,
    paymentTxHash: null,
    paymentVerifiedAt: null,
    ratingCount: 0,
    submittedAt: new Date(),
    publishedAt: null,
    ...overrides,
  };
}

export function mkRating(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.rating,
    submissionId: TEST_IDS.submission,
    curatorWallet: TEST_IDS.curatorWallet,
    soloIntensity: 7,
    vocalQuality: 8,
    energyVsStudio: 'higher' as const,
    tempoFeel: 'rushing' as const,
    moodTags: ['Bluesy', 'Raw'],
    notes: null,
    submittedAt: new Date(),
    ...overrides,
  };
}

export function mkPlaylist(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.playlist,
    name: 'Test Playlist',
    description: 'A test playlist',
    genre: 'rock',
    mood: 'energetic',
    arWallet: TEST_PLATFORM_WALLET,
    trackCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
