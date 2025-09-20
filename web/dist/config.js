// MODULAR: Configuration for different deployment environments
// This allows easy deployment to Netlify, Vercel, or custom domains
// ORGANIZED: Environment-based configuration with proper typing
const config = {
    development: {
        environment: 'development',
        domain: 'localhost:3000',
        apiBase: 'http://localhost:8080',
        manifestUrl: 'http://localhost:3000/.well-known/farcaster.json'
    },
    netlify: {
        environment: 'netlify',
        domain: 'versions-app.netlify.app', // Will be updated with actual Netlify URL
        apiBase: 'https://versions-api.herokuapp.com', // Or wherever you deploy the API
        manifestUrl: 'https://versions-app.netlify.app/.well-known/farcaster.json'
    },
    production: {
        environment: 'production',
        domain: 'versions.app', // Future production domain
        apiBase: 'https://api.versions.app',
        manifestUrl: 'https://versions.app/.well-known/farcaster.json'
    }
};
// CLEAN: Auto-detect environment with proper typing
function getEnvironment() {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'development';
    }
    else if (hostname.includes('netlify.app')) {
        return 'netlify';
    }
    else {
        return 'production';
    }
}
// PERFORMANT: Export current config with type safety
const currentEnv = getEnvironment();
export const appConfig = config[currentEnv];
export const environment = currentEnv;
console.log(`🎭 VERSIONS running in ${currentEnv} mode`);
// ENHANCEMENT: Export type-safe config getter
export function getConfig() {
    return appConfig;
}
// MODULAR: Export for testing and debugging
export { config as allConfigs };
//# sourceMappingURL=config.js.map