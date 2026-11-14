import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import {
  KIOSK_SURFACE_STYLE,
  KioskSurface,
  isEditableTarget,
  suppressContextMenu,
} from './KioskSurface';

describe('isEditableTarget', () => {
  it('treats null, primitives and non-string tagName as non-editable', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget('INPUT')).toBe(false);
    expect(isEditableTarget(42)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget({ tagName: 7 })).toBe(false);
    expect(isEditableTarget({ isContentEditable: 'true' })).toBe(false);
  });

  it('treats plain elements as non-editable', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditableTarget({ tagName: 'button' })).toBe(false);
  });

  it('treats text fields and contenteditable elements as editable, in any tag case', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
});

describe('suppressContextMenu', () => {
  it('prevents the default menu for a non-editable target', () => {
    const preventDefault = jest.fn();

    suppressContextMenu({ target: { tagName: 'DIV' }, preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('prevents the default menu when the event carries no target', () => {
    const preventDefault = jest.fn();

    suppressContextMenu({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves the menu alone on editable targets (INPUT, lowercase textarea, isContentEditable)', () => {
    for (const target of [
      { tagName: 'INPUT' },
      { tagName: 'textarea' },
      { tagName: 'SPAN', isContentEditable: true },
    ]) {
      const preventDefault = jest.fn();

      suppressContextMenu({ target, preventDefault });

      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe('KioskSurface', () => {
  it('renders its children inside a full-height surface with the kiosk style', async () => {
    await render(
      <KioskSurface testID="surface">
        <Text testID="child">hub</Text>
      </KioskSurface>,
    );

    const surface = screen.getByTestId('surface');
    expect(StyleSheet.flatten(surface.props.style)).toEqual({
      flex: 1,
      userSelect: 'none',
      WebkitTouchCallout: 'none',
    });
    expect(StyleSheet.flatten(surface.props.style)).toEqual(StyleSheet.flatten(KIOSK_SURFACE_STYLE));
    expect(surface.props.onContextMenu).toBe(suppressContextMenu);
    expect(screen.getByTestId('child')).toHaveTextContent('hub');
  });

  it('renders without a testID', async () => {
    await render(
      <KioskSurface>
        <Text testID="child">hub</Text>
      </KioskSurface>,
    );

    expect(screen.getByTestId('child')).toBeOnTheScreen();
  });
});
