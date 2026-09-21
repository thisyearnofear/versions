"use client";

import { useCallback, useState } from "react";
import { useSupervisorAuth } from "@/lib/use-supervisor-auth";
import { SupplyCreator } from "@/components/supply/SupplyCreator";
import { SupplierListings } from "@/components/supply/SupplierListings";

export function SupplyPanel({ initialKind = "music" }: { initialKind?: "music" | "placement" }) {
  const { walletAddress } = useSupervisorAuth();
  return <SupplyPanelContent key={walletAddress ?? "guest"} initialKind={initialKind} />;
}

function SupplyPanelContent({ initialKind }: { initialKind: "music" | "placement" }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const onCreated = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <SupplyCreator initialKind={initialKind} onCreated={onCreated} />
      <div className="mt-10 border-t border-[var(--color-hair)] pt-8">
        <SupplierListings refreshKey={refreshKey} />
      </div>
    </>
  );
}
