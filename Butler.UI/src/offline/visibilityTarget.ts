/**
 * The page-visibility seam shared by the hub glance (#122) and the screen wake
 * lock (#109): the ambient document, feature-detected, so both are inert where
 * there is none (native, Jest without a stub). In its own module so a test that
 * mocks `useHubGlance` does not take the wake lock's document with it.
 */

/** The sliver of the DOM document a visibility listener needs (no DOM lib dependency). */
export type VisibilityTarget = {
  readonly visibilityState?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** The ambient document, or `undefined` where there is none (native, Jest). */
export function defaultVisibilityTarget(): VisibilityTarget | undefined {
  try {
    const target = (globalThis as { document?: Partial<VisibilityTarget> }).document;
    return typeof target?.addEventListener === 'function' &&
      typeof target.removeEventListener === 'function'
      ? (target as VisibilityTarget)
      : undefined;
  } catch {
    return undefined;
  }
}
