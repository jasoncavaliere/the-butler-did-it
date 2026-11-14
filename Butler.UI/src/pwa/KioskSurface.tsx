/**
 * The hub kiosk surface (#130).
 *
 * The hub runs full-screen on a shared kitchen tablet. A long-press there should never raise the
 * browser's context menu, select a word, or pop the iOS touch callout - that is a wall display
 * misbehaving, not a feature. This surface wraps the hub (and only the hub: the organizer screens
 * keep browser defaults) in a View that turns selection and the callout off and cancels the
 * `contextmenu` event raised inside it.
 *
 * It is web-only by nature and feature-detected rather than platform-switched: react-native-web
 * forwards `onContextMenu` and the hyphenated style keys to the DOM, while native React Native has
 * no context menu event and ignores the web-only style keys, so this is a plain flex View there
 * without a `Platform.OS` branch.
 *
 * Editable targets are skipped (AC8): a long-press inside a text field must still offer paste, so
 * the handler leaves the menu alone on INPUT, TEXTAREA and contenteditable targets. The matching
 * CSS half - giving those fields their selection back under this surface's `user-select: none` -
 * lives in `public/index.html`.
 */
import type { ComponentType, ReactNode } from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

/** The slice of a DOM `contextmenu` event the handler reads. */
export type ContextMenuEventLike = {
  target?: unknown;
  preventDefault: () => void;
};

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA']);

/** Whether a context-menu target is a text field the user may still select and paste into. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const candidate = target as { isContentEditable?: unknown; tagName?: unknown };
  if (candidate.isContentEditable === true) return true;
  return typeof candidate.tagName === 'string' && EDITABLE_TAGS.has(candidate.tagName.toUpperCase());
}

/** Cancel the browser's context menu unless it was raised on an editable target. */
export function suppressContextMenu(event: ContextMenuEventLike): void {
  if (isEditableTarget(event.target)) return;
  event.preventDefault();
}

/**
 * Full height, no selection, no iOS touch callout. `userSelect` is auto-prefixed by
 * react-native-web; `WebkitTouchCallout` is emitted as `-webkit-touch-callout`. React Native's
 * `ViewStyle` declares neither, hence the cast.
 */
export const KIOSK_SURFACE_STYLE = {
  flex: 1,
  userSelect: 'none',
  WebkitTouchCallout: 'none',
} as ViewStyle;

// React Native's ViewProps has no onContextMenu; react-native-web forwards it to the DOM.
const SurfaceView = View as unknown as ComponentType<
  ViewProps & { onContextMenu?: (event: ContextMenuEventLike) => void }
>;

/** The hub's kiosk wrapper (see the module comment). */
export function KioskSurface({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <SurfaceView style={KIOSK_SURFACE_STYLE} onContextMenu={suppressContextMenu} testID={testID}>
      {children}
    </SurfaceView>
  );
}
