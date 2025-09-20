// VERSIONS Theme Bridge - Immediate consistency solution
// CLEAN: Bridge between TUI theme system and web CSS
// DRY: Single source of truth for terminal colors

// ENHANCEMENT FIRST: Build on existing TUI color system
const TUI_THEME_COLORS = {
    // From lib/src/config/v1/theme.rs - Alacritty default theme
    primary: {
        background: '#101421',  // Terminal background
        foreground: '#fffbf6'   // Terminal foreground
    },
    
    // Normal colors from TUI theme
    normal: {
        black: '#2e2e2e',
        red: '#eb4129', 
        green: '#abe047',
        yellow: '#f6c744',
        blue: '#47a0f3',
        magenta: '#7b5cb0',
        cyan: '#64dbed',
        white: '#e5e9f0'
    },
    
    // Bright colors from TUI theme  
    bright: {
        black: '#565656',
        red: '#ec5357',
        green: '#c0e17d', 
        yellow: '#f9da6a',
        blue: '#49a4f8',
        magenta: '#a47de9',
        cyan: '#99faf2',
        white: '#ffffff'
    },
    
    // VERSIONS-specific accent colors
    accent: {
        terminal_blue: '#00d4ff',    // Primary terminal accent
        terminal_green: '#00ff88',   // Success/active states  
        border: '#2a3441',          // Component borders
        section_bg: 'rgba(26, 32, 44, 0.9)',
        status_bg: 'rgba(16, 20, 33, 0.9)'
    }
};

// MODULAR: Generate CSS custom properties
export function generateCSSVariables() {
    const variables = [];
    
    // Primary colors
    Object.entries(TUI_THEME_COLORS.primary).forEach(([key, value]) => {
        variables.push(`--terminal-${key}: ${value};`);
    });
    
    // Normal colors  
    Object.entries(TUI_THEME_COLORS.normal).forEach(([key, value]) => {
        variables.push(`--color-${key}: ${value};`);
    });
    
    // Bright colors
    Object.entries(TUI_THEME_COLORS.bright).forEach(([key, value]) => {
        variables.push(`--color-bright-${key}: ${value};`);
    });
    
    // Accent colors
    Object.entries(TUI_THEME_COLORS.accent).forEach(([key, value]) => {
        variables.push(`--${key.replace('_', '-')}: ${value};`);
    });
    
    return `:root {\n  ${variables.join('\n  ')}\n}`;
}

// PERFORMANT: Apply theme to document
export function applyTheme() {
    const style = document.createElement('style');
    style.id = 'versions-theme-bridge';
    style.textContent = generateCSSVariables();
    
    // Remove existing theme
    const existing = document.getElementById('versions-theme-bridge');
    if (existing) existing.remove();
    
    document.head.appendChild(style);
}

// CLEAN: Get specific color values
export function getColor(category, color) {
    return TUI_THEME_COLORS[category]?.[color] || '#ffffff';
}

// ORGANIZED: Theme utilities
export const ThemeUtils = {
    // Get terminal-style gradient
    getTerminalGradient() {
        return `linear-gradient(135deg, ${getColor('accent', 'terminal_blue')} 0%, ${getColor('normal', 'magenta')} 100%)`;
    },
    
    // Get status color based on state
    getStatusColor(status) {
        const colors = {
            success: getColor('bright', 'green'),
            error: getColor('bright', 'red'), 
            warning: getColor('bright', 'yellow'),
            info: getColor('accent', 'terminal_blue'),
            active: getColor('accent', 'terminal_green')
        };
        return colors[status] || getColor('primary', 'foreground');
    },
    
    // Generate component-specific styling
    getComponentStyle(component) {
        const styles = {
            terminal_section: {
                background: getColor('accent', 'section_bg'),
                border: `1px solid ${getColor('accent', 'border')}`,
                color: getColor('primary', 'foreground')
            },
            terminal_button: {
                background: `rgba(0, 212, 255, 0.2)`,
                color: getColor('accent', 'terminal_blue'),
                border: `1px solid ${getColor('accent', 'terminal_blue')}`
            },
            api_endpoint: {
                background: `rgba(42, 52, 65, 0.8)`,
                borderLeft: `4px solid ${getColor('accent', 'terminal_blue')}`
            }
        };
        return styles[component] || {};
    }
};

// MODULAR: Export theme data for other modules
export { TUI_THEME_COLORS };

// Auto-apply theme when module loads
if (typeof document !== 'undefined') {
    applyTheme();
    console.log('🎨 VERSIONS theme bridge applied - TUI colors active');
}