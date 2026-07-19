import { render, screen } from '@testing-library/react-native';

import App from './App';

describe('App', () => {
  it('renders the Home screen through the navigator', async () => {
    await render(<App />);

    expect(await screen.findByText('Welcome home')).toBeOnTheScreen();
  });
});
