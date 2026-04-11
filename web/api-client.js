(function initVersionsApiClient(globalScope) {
  const isLocalhost = globalScope.location.hostname === 'localhost';
  const baseUrl = isLocalhost
    ? 'http://localhost:8080'
    : 'https://versions.thisyearnofear.com';

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  globalScope.VersionsApi = {
    baseUrl,
    request,
    getJson(path) {
      return request(path);
    },
    postJson(path, body) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
  };

  globalScope.API_PROXY = baseUrl;
})(window);

