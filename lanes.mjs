export function lanesForLink(mps) {
  const speed = Number(mps);
  if (!Number.isFinite(speed) || speed <= 0) return 4;
  if (speed < 12) return 2;
  if (speed < 25) return 4;
  if (speed < 75) return 6;
  if (speed < 160) return 8;
  if (speed < 300) return 10;
  return 12;
}
