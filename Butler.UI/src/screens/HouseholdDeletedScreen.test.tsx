import { act, render, screen } from '@testing-library/react-native';

import {
  HOUSEHOLD_DELETED_COPY,
  HOUSEHOLD_DELETED_NOTICE_MS,
  HouseholdDeletedScreen,
} from './HouseholdDeletedScreen';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('HouseholdDeletedScreen (#168 AC9)', () => {
  it('shows the notice for 3 s by default', () => {
    expect(HOUSEHOLD_DELETED_NOTICE_MS).toBe(3000);
  });

  it('shows Household deleted for HOUSEHOLD_DELETED_NOTICE_MS (3000) then calls onDone', async () => {
    const onDone = jest.fn();
    await render(<HouseholdDeletedScreen onDone={onDone} />);

    expect(screen.getByTestId('household-deleted-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Household deleted' })).toBeOnTheScreen();
    expect(screen.getByText(HOUSEHOLD_DELETED_COPY.body)).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(2999);
    });
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('honours a shorter duration', async () => {
    const onDone = jest.fn();
    await render(<HouseholdDeletedScreen onDone={onDone} durationMs={500} />);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('never calls onDone when unmounted early', async () => {
    const onDone = jest.fn();
    const view = await render(<HouseholdDeletedScreen onDone={onDone} />);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps its copy plain ASCII', () => {
    expect(JSON.stringify(HOUSEHOLD_DELETED_COPY)).toMatch(/^[\x00-\x7F]*$/);
  });
});
