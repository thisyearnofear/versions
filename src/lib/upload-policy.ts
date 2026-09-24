// MODULAR: upload storage policy for the architecture split.
// Local disk is a demo/dev fallback; production should pin to Pinata
// (LOCAL_UPLOADS=0) so the VPS does not accumulate audio.

/** When false, submissions must succeed via IPFS — no data/uploads write. */
export function localUploadsAllowed(): boolean {
  const raw = process.env.LOCAL_UPLOADS;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no" || v === "off");
}
