import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { LandingExperience } from "@/components/home/LandingExperience";

export const metadata: Metadata = {
  title: "VERSIONS — supply that fits your channel",
  description:
    "Find music and product placements that fit what you publish. Use free listings with required credit, or buy a paid placement with clear pricing, disclosure, and settlement on Arc.",
};

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col">
      <SiteHeader />
      <LandingExperience />
      <SiteFooter />
    </div>
  );
}
