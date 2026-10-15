export function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
/** Parse "Owner-Name-1.2.3" or "Owner-Name". Name/owner never contain '-'. */
export function parseRef(ref: string): { fullName: string; version?: string } {
  const s = ref.trim();
  const m = s.match(/^(.+)-(\d+\.\d+\.\d+)$/);
  if (m) return { fullName: m[1], version: m[2] };
  return { fullName: s };
}
