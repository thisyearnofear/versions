function createAudioComposeService({ vectorIndex, audioGenerator }) {
  return {
    async compose({ query, mode = 'music', topK = 5, durationSeconds }) {
      const retrieval = await vectorIndex.semanticSearch({ query, topK });
      const generation = await audioGenerator.generate({
        mode,
        prompt: query,
        durationSeconds
      });

      return {
        query,
        mode,
        retrieval,
        generation
      };
    }
  };
}

module.exports = {
  createAudioComposeService
};

