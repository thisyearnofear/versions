"use client";

import { cn } from "@/lib/utils";
import type { ListenerBadgeResponse } from "@/lib/api-client";

interface ListenerBadgeProps {
  badge: ListenerBadgeResponse;
  earned?: boolean;
  size?: "sm" | "md" | "lg";
}

export function ListenerBadge({ badge, earned = true, size = "md" }: ListenerBadgeProps) {
  const sizeClasses = {
    sm: "w-12 h-12 text-lg",
    md: "w-16 h-16 text-2xl",
    lg: "w-20 h-20 text-3xl",
  };

  return (
    <div
      className={cn(
        "relative group flex flex-col items-center gap-1.5",
        !earned && "opacity-30",
      )}
      title={earned ? `${badge.label}: ${badge.description}` : "Not yet earned"}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full border-2 transition-all duration-300",
          sizeClasses[size],
          earned
            ? "border-[var(--color-rust)] bg-[var(--color-rust)]/10 shadow-sm shadow-[var(--color-rust)]/20"
            : "border-[var(--color-hair-strong)] bg-[var(--color-hair)]",
        )}
      >
        <span className={cn(earned && "group-hover:scale-110 transition-transform")}>
          {badge.icon}
        </span>
      </div>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-center leading-tight text-[var(--color-ink-2)]">
        {badge.label}
      </span>
    </div>
  );
}

export function BadgeGrid({ badges, size }: { badges: ListenerBadgeResponse[]; size?: "sm" | "md" | "lg" }) {
  const allBadgeTypes = [
    { badgeType: "explorer", label: "Explorer", description: "10 distinct tracks", icon: "🎧" },
    { badgeType: "supporter", label: "Supporter", description: "50 paid plays", icon: "⭐" },
    { badgeType: "curator", label: "Curator", description: "100 plays", icon: "🎵" },
    { badgeType: "tastemaker", label: "Tastemaker", description: "500 plays", icon: "👑" },
    { badgeType: "early_adopter", label: "Early Adopter", description: "First discoverers", icon: "🔮" },
  ];

  const ownedBadges = new Set(badges.map((b) => b.badgeType));

  return (
    <div className="flex flex-wrap gap-4 justify-center">
      {allBadgeTypes.map((def) => {
        const earned = ownedBadges.has(def.badgeType);
        const badge = badges.find((b) => b.badgeType === def.badgeType);
        return (
          <ListenerBadge
            key={def.badgeType}
            badge={
              badge ?? {
                id: `${def.badgeType}_unearned`,
                badgeType: def.badgeType,
                label: def.label,
                description: def.description,
                icon: def.icon,
                awardedAt: "",
              }
            }
            earned={earned}
            size={size}
          />
        );
      })}
    </div>
  );
}
