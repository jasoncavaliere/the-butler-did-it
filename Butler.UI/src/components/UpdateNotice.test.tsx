import { render, screen } from '@testing-library/react-native';

import { UPDATE_NOTICE_MS, UpdateNotice } from './UpdateNotice';

describe('UpdateNotice', () => {
  it("renders 'Updated to build <sha>' as a polite live region", async () => {
    await render(<UpdateNotice build="abc1234" />);

    const notice = screen.getByTestId('hub-update-notice');
    expect(notice).toHaveTextContent('Updated to build abc1234');
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
  });

  it('is transient: shown for ten seconds', () => {
    expect(UPDATE_NOTICE_MS).toBe(10_000);
  });
});
