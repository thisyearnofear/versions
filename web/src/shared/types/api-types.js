// VERSIONS Shared Types - TypeScript definitions mirroring Rust API structs
// DRY: Single source of truth for data structures across TUI and Web
// CLEAN: Explicit types for better development experience
// Type Guards for Runtime Type Checking
export function isApiResponse(obj) {
    return obj && typeof obj.success === 'boolean';
}
export function isVersionInfo(obj) {
    return obj &&
        typeof obj.id === 'string' &&
        typeof obj.title === 'string' &&
        typeof obj.artist === 'string' &&
        typeof obj.version_type === 'string';
}
export function isFarcasterUser(obj) {
    return obj &&
        typeof obj.fid === 'number' &&
        typeof obj.username === 'string';
}
//# sourceMappingURL=api-types.js.map