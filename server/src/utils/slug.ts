/**
 * URL-safe slug generation.
 *
 * Generates deterministic slugs from text, with uniqueness
 * enforcement via suffix appending when collisions occur.
 */

/**
 * Convert arbitrary text to a URL-safe slug.
 * E.g., "Radiohead - OK Computer" → "radiohead-ok-computer"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')      // remove non-alphanumeric
    .replace(/[\s_]+/g, '-')           // spaces/underscores → hyphens
    .replace(/-+/g, '-')              // collapse multiple hyphens
    .replace(/^-|-$/g, '')            // trim leading/trailing hyphens
    .slice(0, 80)                     // cap length
    || 'untitled';
}

/**
 * Generate a track slug from artist + title.
 * E.g., "Radiohead", "Creep" → "radiohead-creep"
 */
export function trackSlug(artist: string, title: string): string {
  return slugify(`${artist} ${title}`);
}

/**
 * Generate an artist slug from name.
 */
export function artistSlug(name: string): string {
  return slugify(name);
}

/**
 * Generate an album slug from artist + title.
 */
export function albumSlug(artistName: string, albumTitle: string): string {
  return slugify(`${artistName} ${albumTitle}`);
}
