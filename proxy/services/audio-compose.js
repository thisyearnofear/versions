function createAudioComposeService({ vectorIndex, audioGenerator }) {
  return {
    async compose({ query, mode = 'music', topK = 5, durationSeconds, trackContext }) {
      // Step 1: Semantic search for relevant tracks
      let retrieval = [];
      try {
        retrieval = await vectorIndex.semanticSearch({ query, topK });
      } catch (err) {
        console.warn('Semantic search failed, proceeding with raw prompt:', err.message);
      }

      // Step 2: Enrich the generation prompt with search context
      const enrichedPrompt = buildEnrichedPrompt(query, retrieval, trackContext);

      // Step 3: Generate audio with enriched prompt
      const generation = await audioGenerator.generate({
        mode,
        prompt: enrichedPrompt,
        durationSeconds
      });

      return {
        query,
        enriched_prompt: enrichedPrompt,
        mode,
        retrieval: formatRetrievalResults(retrieval),
        generation
      };
    }
  };
}

/**
 * Build an enriched prompt by combining the user query with metadata
 * from the top semantic search results.
 */
function buildEnrichedPrompt(query, searchResults, trackContext) {
  const parts = [query];

  // Add track context if provided (e.g., from track-detail "Generate Missing Version")
  if (trackContext) {
    if (trackContext.genre) parts.push(`Genre: ${trackContext.genre}`);
    if (trackContext.mood) parts.push(`Mood: ${trackContext.mood}`);
    if (trackContext.instruments) parts.push(`Instruments: ${trackContext.instruments}`);
    if (trackContext.artist) parts.push(`Inspired by: ${trackContext.artist}`);
  }

  // Extract context from top search results
  if (Array.isArray(searchResults) && searchResults.length > 0) {
    const contextParts = [];
    for (const result of searchResults.slice(0, 3)) {
      const attrs = result.attributes || result;
      const bits = [];
      if (attrs.genre) bits.push(attrs.genre);
      if (attrs.mood) bits.push(attrs.mood);
      if (attrs.tags) bits.push(typeof attrs.tags === 'string' ? attrs.tags : (Array.isArray(attrs.tags) ? attrs.tags.join(', ') : ''));
      if (attrs.description) bits.push(attrs.description.slice(0, 80));
      if (bits.length > 0) contextParts.push(bits.filter(Boolean).join(', '));
    }
    if (contextParts.length > 0) {
      parts.push(`Style references: ${contextParts.join('; ')}`);
    }
  }

  return parts.join('. ');
}

/**
 * Format retrieval results into a consistent shape for the frontend.
 */
function formatRetrievalResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    dist: r.dist ?? r.distance ?? null,
    attributes: r.attributes || {},
    title: r.attributes?.title || r.title || `Match #${i + 1}`,
    artist: r.attributes?.artist || r.artist || 'Unknown',
    genre: r.attributes?.genre || r.genre || '',
    mood: r.attributes?.mood || r.mood || ''
  }));
}

module.exports = {
  createAudioComposeService
};

