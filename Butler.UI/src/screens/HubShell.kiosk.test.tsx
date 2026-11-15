/**
 * The hub kiosk surface (#130): the whole hub renders inside one
 * {@link KioskSurface} that turns off selection and the touch callout and
 * cancels the context menu, while the grocery text input stays usable.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HubShell } from './HubShell';
import type { ApiClient, ApiResult } from '../api/client';
import { DATASET_PATH } from '../api/dataset';
import { useApiClient } from '../api/useApiClient';
import { HouseholdProvider } from '../state/HouseholdContext';

jest.mock('../api/useApiClient', () => ({ useApiClient: jest.fn() }));
// The hub glance (#122) is covered by HubShell.glance.test.tsx.
jest.mock('../offline/useHubGlance', () => ({ useHubGlance: jest.fn() }));

const useApiClientMock = useApiClient as jest.MockedFunction<typeof useApiClient>;

type HostNode = {
  props: Record<string, unknown> & { testID?: string; style?: unknown };
  parent: HostNode | null;
};

const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data, etag: null });

const okHousehold = ok({ householdId: 'hh-1', name: 'The Riveras' });
const okPeople = ok([
  { personId: 'p1', displayName: 'Alex', claimColor: '#B0206F', isChild: false },
]);
const okDataset = ok({ datasetId: 'ds-1' });
const okChores = ok([]);
const okCart = ok({
  weekIso: '2026-W29',
  status: 'Building',
  confirmedByPersonId: null,
  confirmedUtc: null,
  eTag: 'W/"cart-1"',
  items: [],
  estimatedTotal: 0,
  customItemCount: 0,
});

/** A client that answers every hub read calmly, or holds the dataset check open. */
function clientWith({ holdDataset = false }: { holdDataset?: boolean } = {}): ApiClient {
  return {
    baseUrl: 'http://api.test:1',
    get: jest.fn(async (path: string): Promise<ApiResult<unknown>> => {
      if (path === DATASET_PATH) {
        return holdDataset ? new Promise<ApiResult<unknown>>(() => {}) : okDataset;
      }
      if (path.includes('/chores')) {
        return okChores;
      }
      if (path.includes('/carts/')) {
        return okCart;
      }
      // The board's lazy week read (#110): an empty set for the week it asked for.
      const week = /\/assignments\/(\d{4}-W\d{2})$/.exec(path)?.[1];
      if (week !== undefined) {
        return ok({ weekIso: week, currentWeekIso: week, assignments: [], unassigned: [] });
      }
      return path.endsWith('/people') ? okPeople : okHousehold;
    }) as unknown as ApiClient['get'],
    update: jest.fn(async (): Promise<ApiResult<unknown>> => ok(null)) as unknown as ApiClient['update'],
  };
}

function renderHub() {
  return render(
    <HouseholdProvider initialHouseholdId="hh-1">
      <HubShell />
    </HouseholdProvider>,
  );
}

/** Whether `node` sits inside the element with `testID`. */
function isWithin(node: HostNode, testID: string): boolean {
  for (let at: HostNode | null = node.parent; at !== null; at = at.parent) {
    if (at.props.testID === testID) {
      return true;
    }
  }
  return false;
}

/** Whether `node` or any ancestor turns text selection off. */
function selectionOffAbove(node: HostNode, stopAt: string): boolean {
  for (let at: HostNode | null = node; at !== null; at = at.parent) {
    if (at.props.testID === stopAt) {
      return false;
    }
    const style = StyleSheet.flatten(at.props.style as never) as { userSelect?: string } | undefined;
    if (style?.userSelect === 'none') {
      return true;
    }
  }
  return false;
}

afterEach(() => {
  useApiClientMock.mockReset();
});

describe('HubShell kiosk surface', () => {
  it('wraps the hub in a kiosk surface with no selection or touch callout (#130)', async () => {
    useApiClientMock.mockReturnValue(clientWith());

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Riveras'));
    const surface = screen.getByTestId('hub-kiosk-surface');
    expect(StyleSheet.flatten(surface.props.style)).toEqual(
      expect.objectContaining({ flex: 1, userSelect: 'none', WebkitTouchCallout: 'none' }),
    );
    expect(typeof surface.props.onContextMenu).toBe('function');
    // The surface is the outermost element: the shell sits inside it.
    expect(isWithin(screen.getByTestId('hub-shell') as unknown as HostNode, 'hub-kiosk-surface')).toBe(true);
  });

  it('keeps the kiosk surface while the dataset check is pending (#130)', async () => {
    useApiClientMock.mockReturnValue(clientWith({ holdDataset: true }));

    await renderHub();

    const check = screen.getByTestId('hub-dataset-check');
    expect(isWithin(check as unknown as HostNode, 'hub-kiosk-surface')).toBe(true);
    expect(StyleSheet.flatten(screen.getByTestId('hub-kiosk-surface').props.style)).toEqual(
      expect.objectContaining({ userSelect: 'none', WebkitTouchCallout: 'none' }),
    );
  });

  it('cancels the context menu raised inside the hub (#130)', async () => {
    useApiClientMock.mockReturnValue(clientWith());

    await renderHub();

    await waitFor(() => expect(screen.getByTestId('hub-household-name')).toHaveTextContent('The Riveras'));
    const preventDefault = jest.fn();
    await fireEvent(screen.getByTestId('hub-household-name'), 'contextMenu', {
      target: { tagName: 'DIV' },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('keeps the grocery input selectable and editable inside the kiosk surface (#130)', async () => {
    useApiClientMock.mockReturnValue(clientWith());

    await renderHub();

    const input = await screen.findByTestId('grocery-add-input');
    expect(isWithin(input as unknown as HostNode, 'hub-kiosk-surface')).toBe(true);
    expect(input.props.editable).not.toBe(false);
    // Nothing between the input and the surface turns selection off; the
    // surface's own user-select: none is undone for inputs in index.html.
    expect(selectionOffAbove(input as unknown as HostNode, 'hub-kiosk-surface')).toBe(false);

    await fireEvent.changeText(input, 'oat milk');
    expect(screen.getByTestId('grocery-add-input')).toHaveProp('value', 'oat milk');

    // The surface's handler does run for the input (it reads the target's tag)
    // and leaves the menu alone, so a long-press can still paste.
    const preventDefault = jest.fn();
    const readTag = jest.fn(() => 'INPUT');
    const target = {};
    Object.defineProperty(target, 'tagName', { get: readTag });
    await fireEvent(screen.getByTestId('grocery-add-input'), 'contextMenu', { target, preventDefault });
    expect(readTag).toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
