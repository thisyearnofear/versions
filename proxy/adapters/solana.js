const { requestJson } = require('../runtime/http');

function createHeliusAdapter({ apiKey, requestTimeoutMs }) {
  return {
    async rpc(payload) {
      if (!apiKey) {
        throw new Error('HELIUS_API_KEY not configured');
      }

      return requestJson(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: requestTimeoutMs
      }, 'Helius RPC');
    }
  };
}

module.exports = {
  createHeliusAdapter
};
