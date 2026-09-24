"use client";

// React binding for the kit store — one stable snapshot for
// useSyncExternalStore so a render that reads the kit never re-cascades
// because the array reference changed when the contents didn't
// (the store's bug class: see market/primitives docs).

import { useSyncExternalStore } from "react";
import { getKitSnapshot, getKitServerSnapshot, subscribeToKit, type KitItem } from "@/lib/kit";

export function useKit(): KitItem[] {
  return useSyncExternalStore(subscribeToKit, getKitSnapshot, getKitServerSnapshot);
}
