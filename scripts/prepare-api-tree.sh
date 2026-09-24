#!/usr/bin/env bash
# Strip UI-only App Router surfaces before `next build` for the API image.
# Keeps /api/*, /t/*, and a minimal root layout so the standalone server
# does not pull RainbowKit / page components into the box image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ prepare-api-tree: removing UI routes + client providers"

rm -rf \
  src/app/discover \
  src/app/submit \
  src/app/channels \
  src/app/auth \
  src/app/placements \
  src/app/legal \
  src/app/listings \
  src/components

rm -f \
  src/app/globals.css \
  src/app/opengraph-image.tsx \
  src/app/icon.tsx \
  src/app/apple-icon.tsx

# Minimal root (Next requires app/page.tsx)
cat > src/app/page.tsx <<'EOF'
import { redirect } from "next/navigation";

/** API host — browsers use Netlify; send humans to the public UI. */
export default function ApiHostIndex() {
  redirect("https://versions.persidian.com");
}
EOF

# No wallet / RainbowKit on the API image
cat > src/app/providers.tsx <<'EOF'
import type { ReactNode } from "react";

/** API-host stub — UI Providers (wagmi/RainbowKit) live on Netlify. */
export function Providers({ children }: { children: ReactNode }) {
  return children;
}
EOF

# Lean layout: system fonts, no Google font download at build time
cat > src/app/layout.tsx <<'EOF'
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "VERSIONS API",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
EOF

# Drop CSS that only styled the UI shell (API responses are JSON)
rm -f src/app/globals.css

echo "→ prepare-api-tree: done"
