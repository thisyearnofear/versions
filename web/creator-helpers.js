// MODULAR: Creator dashboard helpers following our Core Principles
// CLEAN: Separate concerns for creator-specific functionality

import { FilecoinHelpers } from './filecoin-integration.js';

// DRY: Centralized creator dashboard formatting
export const CreatorHelpers = {
    // CLEAN: Format earnings for terminal display
    formatEarnings(usdAmount) {
        const amount = parseFloat(usdAmount);
        if (amount === 0) return '$0.00';
        if (amount < 0.01) return '< $0.01';
        return `$${amount.toFixed(2)}`;
    },

    // CLEAN: Format play count with terminal style
    formatPlayCount(count) {
        if (count < 1000) return count.toString();
        if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
        return `${(count / 1000000).toFixed(1)}M`;
    },

    // CLEAN: Format time ago for terminal display
    formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'today';
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        return `${Math.floor(diffDays / 30)} months ago`;
    },

    // CLEAN: Format growth rate with terminal indicators
    formatGrowthRate(rate) {
        if (!rate) return '0%';
        const isPositive = rate.startsWith('+');
        const isNegative = rate.startsWith('-');
        
        if (isPositive) return `↑${rate}`;
        if (isNegative) return `↓${rate}`;
        return rate;
    },

    // CLEAN: Generate terminal-style earnings summary
    generateEarningsSummary(earnings) {
        return `
CREATOR EARNINGS SUMMARY
${'='.repeat(24)}
Total: ${this.formatEarnings(earnings.total_earnings_usd)} (${earnings.active_rails} active rails)
Last Updated: ${this.formatTimeAgo(earnings.last_updated)}
`;
    },

    // CLEAN: Generate terminal-style version table
    generateVersionTable(versions) {
        if (!versions || versions.length === 0) {
            return 'No versions found.';
        }

        let table = '\nTOP PERFORMING VERSIONS\n';
        table += '='.repeat(50) + '\n';
        table += 'VERSION                  EARNINGS   PLAYS   LAST PAYMENT\n';
        table += '-'.repeat(50) + '\n';
        
        versions.slice(0, 5).forEach(version => {
            const title = version.title.length > 20 ? 
                version.title.substring(0, 17) + '...' : 
                version.title.padEnd(20);
            const earnings = this.formatEarnings(version.earnings_usd).padStart(8);
            const plays = this.formatPlayCount(version.play_count).padStart(6);
            const lastPayment = this.formatTimeAgo(version.last_payment);
            
            table += `${title} ${earnings} ${plays}   ${lastPayment}\n`;
        });
        
        return table;
    },

    // CLEAN: Generate terminal-style analytics display
    generateAnalyticsDisplay(analytics) {
        if (!analytics) return 'Analytics unavailable.';
        
        return `
ANALYTICS (${analytics.period})
${'='.repeat(20)}
Total Plays: ${this.formatPlayCount(analytics.total_plays)}
Supporters: ${analytics.total_supporters}
Avg Support: ${this.formatEarnings(analytics.avg_support_amount)}
Growth: ${this.formatGrowthRate(analytics.growth_rate)}
Top Countries: ${analytics.top_countries.slice(0, 3).join(', ')}
`;
    },

    // CLEAN: Generate terminal-style command output
    generateTerminalOutput(command, output) {
        return `$ ${command}\n${output}`;
    },

    // PERFORMANT: Generate progress indicator
    generateProgressBar(percentage, width = 20) {
        const filled = Math.floor((percentage / 100) * width);
        const empty = width - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }
};