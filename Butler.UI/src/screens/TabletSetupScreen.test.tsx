import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import { TABLET_SETUP_COPY, TabletSetupScreen } from './TabletSetupScreen';
import { typeScale } from '../theme/theme';

/** Every string the screen shows, from the copy constant (keys excluded). */
function copyStrings(): string[] {
  const copy = TABLET_SETUP_COPY;
  return [
    copy.heading,
    copy.intro,
    ...copy.points.flatMap((point) => [point.title, point.body]),
    copy.link,
    copy.done,
  ];
}

/** Brands and products the screen must not recommend (#248 AC2). */
const BRANDS = [
  'lenovo',
  'samsung',
  'galaxy',
  'tab m11',
  'tab a9',
  'amazon',
  'fire hd',
  'apple',
  'ipad',
  'google',
  'pixel',
  'fully kiosk',
  'kasa',
  'anker',
];

describe('TabletSetupScreen (#248)', () => {
  // jest-expo already mocks Linking.openURL, so spyOn hands back that same mock
  // and its calls would carry over from one test to the next.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the heading and intro', async () => {
    await render(<TabletSetupScreen />);

    expect(screen.getByTestId('tablet-setup-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Tablet setup' })).toBeOnTheScreen();
    expect(screen.getByText(TABLET_SETUP_COPY.intro)).toBeOnTheScreen();
  });

  it('states the three setup points (#248 AC2)', async () => {
    await render(<TabletSetupScreen />);

    const charging = screen.getByTestId('tablet-setup-point-charging');
    expect(within(charging).getByRole('header', { name: 'Cap charging' })).toBeOnTheScreen();
    expect(within(charging).getByText(/charge cap/)).toBeOnTheScreen();

    const mount = screen.getByTestId('tablet-setup-point-mount');
    expect(
      within(mount).getByRole('header', { name: 'Mount it with permanent power' }),
    ).toBeOnTheScreen();
    expect(within(mount).getByText(/nearest outlet/)).toBeOnTheScreen();

    const lockdown = screen.getByTestId('tablet-setup-point-lockdown');
    expect(within(lockdown).getByRole('header', { name: 'Lock it down' })).toBeOnTheScreen();
    expect(within(lockdown).getByText(/kiosk app or the tablet's single-app mode/)).toBeOnTheScreen();

    expect(TABLET_SETUP_COPY.points).toHaveLength(3);
  });

  it('keeps the copy at 120 words or fewer (#248 AC2)', () => {
    const words = copyStrings()
      .join(' ')
      .split(/\s+/)
      .filter((word) => word.length > 0);

    expect(words.length).toBeGreaterThan(0);
    expect(words.length).toBeLessThanOrEqual(120);
  });

  it('names no brand (#248 AC2)', async () => {
    await render(<TabletSetupScreen onDone={jest.fn()} />);

    const shown =
      `${JSON.stringify(TABLET_SETUP_COPY)} ${JSON.stringify(screen.toJSON())}`.toLowerCase();
    for (const brand of BRANDS) {
      expect(shown).not.toContain(brand);
    }
  });

  it('keeps every copy string plain ASCII', async () => {
    await render(<TabletSetupScreen onDone={jest.fn()} />);

    expect(JSON.stringify(TABLET_SETUP_COPY)).toMatch(/^[\x00-\x7F]*$/);
    expect(JSON.stringify(screen.toJSON())).toMatch(/^[\x00-\x7F]*$/);
  });

  it('opens the docs/17 article on GitHub when the link is tapped (#248 AC3)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<TabletSetupScreen />);

    const link = screen.getByTestId('tablet-setup-article-link');
    expect(link).toHaveTextContent('Read the full setup guide');
    expect(screen.getByRole('link', { name: 'Read the full setup guide' })).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(link);
    });

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(
      'https://github.com/jasoncavaliere/the-butler-did-it/blob/main/Butler.KnowledgeBase/docs/17-byo-tablet-setup-guidance.md',
    );
  });

  it('stays on screen when the browser refuses to open the link', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('no browser available'));
    await render(<TabletSetupScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('tablet-setup-article-link'));
    });

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tablet-setup-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('tablet-setup-point-lockdown')).toBeOnTheScreen();
  });

  it('renders its text with no network read (#248 AC4)', async () => {
    // Offline: any fetch would fail. The screen renders without an API client,
    // household, or organizer provider in the tree, and never calls fetch.
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await render(<TabletSetupScreen onDone={jest.fn()} />);

      for (const text of copyStrings()) {
        expect(screen.getByText(text)).toBeOnTheScreen();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('renders Done only when onDone is supplied, and calls it', async () => {
    const onDone = jest.fn();
    await render(<TabletSetupScreen onDone={onDone} />);

    const done = screen.getByTestId('tablet-setup-done');
    expect(done).toHaveTextContent('Done');

    await act(async () => {
      fireEvent.press(done);
    });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders no Done button without onDone', async () => {
    await render(<TabletSetupScreen />);

    expect(screen.getByTestId('tablet-setup-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('tablet-setup-done')).toBeNull();
  });

  it('sets the point text at or above the body size (ADR-0004)', async () => {
    await render(<TabletSetupScreen />);

    const body = screen.getByText(TABLET_SETUP_COPY.points[0].body);
    expect(StyleSheet.flatten(body.props.style).fontSize).toBeGreaterThanOrEqual(typeScale.body);
  });
});
