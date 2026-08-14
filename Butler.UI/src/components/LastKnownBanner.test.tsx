import { render, screen } from '@testing-library/react-native';

import { LastKnownBanner } from './LastKnownBanner';

describe('LastKnownBanner', () => {
  it('says the view is last-known, aged from the freshness stamp', async () => {
    const twelveMinutesAgo = new Date(Date.now() - 12 * 60_000).toISOString();

    await render(<LastKnownBanner cachedAtIso={twelveMinutesAgo} />);

    expect(screen.getByTestId('last-known-banner')).toHaveTextContent(
      'Showing last-known - saved 12 minutes ago',
    );
  });
});
