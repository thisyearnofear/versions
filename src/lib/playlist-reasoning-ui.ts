// MODULAR: pure reveal-mode logic for the A&R rationale disclosure.
// Kept out of the component so the typewriter-vs-instant decision is
// unit-testable without jsdom (repo convention — see use-typewriter).
//
// Rules:
// - collapsed → hidden
// - expanded and already typed once this session → instant
// - expanded and not yet typed (fresh via generate/SSE, or first
//   manual expand) → typewriter
// Plain page loads never auto-typewrite because cards mount collapsed
// unless marked fresh.

export type RevealMode = 'typewriter' | 'instant' | 'hidden';

export function reasoningRevealMode({
  expanded,
  played,
}: {
  expanded: boolean;
  played: boolean;
}): RevealMode {
  if (!expanded) return 'hidden';
  return played ? 'instant' : 'typewriter';
}
