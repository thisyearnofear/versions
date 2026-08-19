// MODULAR: One-click example briefs for the supervisor inverse-search.
// Shown as quick-fill chips under the brief textarea in DiscoverView so
// a cold visitor can try the search with zero typing. Each brief is
// written to score against at least one seeded placement brief in
// scripts/seed-catalog.ts (kept in sync by hand — add a chip whenever a
// new seeded scenario lands, and vice versa).
//
// Label is the short chip text; brief is the full pasted query.

export interface ExampleBrief {
  id: string;
  label: string;
  brief: string;
}

export const EXAMPLE_BRIEFS: ExampleBrief[] = [
  {
    id: "pilot-authorized",
    label: "Authorized pilot",
    brief: "dark ambient cinematic",
  },
  {
    id: "neon-chase",
    label: "Neon chase",
    brief: "Tense neon-lit car chase at night, electronic, no vocals, building to a release around 1:30",
  },
  {
    id: "cabin-porch",
    label: "Cabin porch",
    brief: "Quiet reflective scene, acoustic guitar, intimate and warm, a little melancholic",
  },
  {
    id: "training-montage",
    label: "Training montage",
    brief: "Gritty urban training montage, raw hip-hop with a strong driving beat and commanding delivery",
  },
  {
    id: "sunset-drive",
    label: "Sunset drive",
    brief: "Nostalgic sunset drive with synthwave energy, steady build into a melodic payoff",
  },
  {
    id: "breakfast-scene",
    label: "Breakfast scene",
    brief: "Bright optimistic morning scene, light acoustic indie pop, no heavy drums",
  },
];
