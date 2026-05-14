/**
 * Deterministic display avatar (SVG URL). Used when the user has not set a custom image.
 * Seed keeps the image stable per user; DiceBear hosts the asset.
 */
export function buildDefaultAvatarUrl(seed: string): string {
  const safe = (seed || 'user').replace(/[^\w.-]/g, '').slice(0, 64) || 'user';
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(safe)}`;
}

export function resolveUserAvatarUrl(user: {
  id: string;
  username?: string | null;
  avatar_url?: string | null;
}): string {
  if (user.avatar_url && user.avatar_url.trim().length > 0) {
    return user.avatar_url;
  }
  return buildDefaultAvatarUrl(user.username || user.id);
}
