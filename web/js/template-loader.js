// VERSIONS Template Loader - Modular HTML Components
// MODULAR: Component-based architecture for better maintainability  
// CLEAN: Separation of concerns between structure and logic

export class TemplateLoader {
    constructor() {
        this.templates = new Map();
        this.loadedComponents = new Set();
        // PERFORMANT: Cache templates for reuse
        this.templateCache = new Map();
    }

    // ORGANIZED: Load template from file or cache
    async loadTemplate(templateName) {
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName);
        }

        try {
            const response = await fetch(`./templates/${templateName}.html`);
            if (!response.ok) {
                throw new Error(`Template ${templateName} not found`);
            }
            
            const content = await response.text();
            this.templateCache.set(templateName, content);
            return content;
        } catch (error) {
            console.warn(`Failed to load template ${templateName}:`, error);
            return `<div class="error">Template ${templateName} not found</div>`;
        }
    }

    // MODULAR: Render template into target element
    async renderTemplate(templateName, targetSelector, data = {}) {
        const target = document.querySelector(targetSelector);
        if (!target) {
            console.error(`Target element ${targetSelector} not found`);
            return false;
        }

        const template = await this.loadTemplate(templateName);
        
        // CLEAN: Simple template variable replacement
        let rendered = template;
        Object.entries(data).forEach(([key, value]) => {
            rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value);
        });

        target.innerHTML = rendered;
        this.loadedComponents.add(templateName);
        
        // ENHANCEMENT: Emit event for component lifecycle
        target.dispatchEvent(new CustomEvent('template-loaded', { 
            detail: { templateName, data } 
        }));
        
        return true;
    }

    // PERFORMANT: Load multiple templates in parallel
    async renderTemplates(templates) {
        const promises = templates.map(({ name, target, data }) => 
            this.renderTemplate(name, target, data)
        );
        
        return Promise.all(promises);
    }

    // CLEAN: Check if component is loaded
    isComponentLoaded(componentName) {
        return this.loadedComponents.has(componentName);
    }

    // MODULAR: Dynamic component loading with error handling
    async loadComponent(componentName, targetSelector, options = {}) {
        const { data = {}, onLoad, onError, lazy = false } = options;
        
        try {
            // PERFORMANT: Skip if already loaded and not forcing reload
            if (this.isComponentLoaded(componentName) && !options.forceReload) {
                return true;
            }

            // LAZY: Load on interaction if specified
            if (lazy) {
                return this.setupLazyLoading(componentName, targetSelector, options);
            }

            const success = await this.renderTemplate(componentName, targetSelector, data);
            
            if (success && onLoad) {
                onLoad();
            }
            
            return success;
        } catch (error) {
            console.error(`Error loading component ${componentName}:`, error);
            if (onError) {
                onError(error);
            }
            return false;
        }
    }

    // PERFORMANT: Lazy loading for non-critical components
    setupLazyLoading(componentName, targetSelector, options) {
        const target = document.querySelector(targetSelector);
        if (!target) return false;

        // Create placeholder
        target.innerHTML = `
            <div class="lazy-component-placeholder terminal-section" 
                 data-component="${componentName}">
                <div class="loading-indicator">
                    <span class="cursor">▋</span> Loading ${componentName}...
                </div>
                <button class="terminal-button load-component-btn">
                    Load ${componentName.charAt(0).toUpperCase() + componentName.slice(1)}
                </button>
            </div>
        `;

        // Setup intersection observer for auto-load
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.renderTemplate(componentName, targetSelector, options.data);
                    observer.disconnect();
                }
            });
        });

        // Setup manual load button
        const loadBtn = target.querySelector('.load-component-btn');
        loadBtn?.addEventListener('click', () => {
            this.renderTemplate(componentName, targetSelector, options.data);
            observer.disconnect();
        });

        observer.observe(target);
        return true;
    }

    // ORGANIZED: Batch template operations
    async loadCriticalComponents() {
        return this.renderTemplates([
            { name: 'header', target: '#header-container' },
            { name: 'interface-cards', target: '#interface-container' },
            { name: 'api-section', target: '#api-container' }
        ]);
    }

    async loadOptionalComponents() {
        const components = [
            { name: 'farcaster-section', target: '#farcaster-container', lazy: true },
            { name: 'audio-player', target: '#audio-container', lazy: true },
            { name: 'wallet-connection', target: '#wallet-container', lazy: true },
            { name: 'filecoin-features', target: '#filecoin-container', lazy: true },
            { name: 'creator-dashboard', target: '#creator-container', lazy: true }
        ];

        return Promise.all(components.map(comp => 
            this.loadComponent(comp.name, comp.target, { lazy: comp.lazy })
        ));
    }

    // DRY: Utility for template preprocessing
    preprocessTemplate(template, context = {}) {
        // Add global template helpers
        const helpers = {
            environment: context.environment || 'development',
            timestamp: new Date().toISOString(),
            version: '0.11.0'
        };

        let processed = template;
        Object.entries(helpers).forEach(([key, value]) => {
            processed = processed.replace(
                new RegExp(`{{${key}}}`, 'g'), 
                value
            );
        });

        return processed;
    }
}

// MODULAR: Export singleton instance
export const templateLoader = new TemplateLoader();

// CLEAN: Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🎭 Template loader initialized');
    });
}