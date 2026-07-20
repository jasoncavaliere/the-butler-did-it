import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { TodayPanel } from './TodayPanel';

describe('TodayPanel', () => {
  it('renders the calm empty placeholder when given no children', async () => {
    await render(<TodayPanel />);

    expect(screen.getByTestId('today-panel')).toBeOnTheScreen();
    expect(screen.getByTestId('today-panel-empty')).toHaveTextContent('The board is being prepared.');
  });

  it('renders supplied children (the C5 seam) instead of the placeholder', async () => {
    await render(
      <TodayPanel>
        <Text testID="board-content">Chore board goes here</Text>
      </TodayPanel>,
    );

    expect(screen.getByTestId('board-content')).toBeOnTheScreen();
    expect(screen.queryByTestId('today-panel-empty')).toBeNull();
  });

  it('treats a falsey child as no content and shows the placeholder', async () => {
    await render(<TodayPanel>{false}</TodayPanel>);

    expect(screen.getByTestId('today-panel-empty')).toBeOnTheScreen();
  });

  it('labels the panel as the active participant\'s day, accented in their claim colour', async () => {
    await render(<TodayPanel activeParticipant={{ displayName: 'Alex', claimColor: '#B0206F' }} />);

    expect(screen.getByText("Alex's day")).toBeOnTheScreen();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('falls back to the brass accent when the active participant has no claim colour', async () => {
    await render(<TodayPanel activeParticipant={{ displayName: 'Sam', claimColor: null }} />);

    expect(screen.getByText("Sam's day")).toBeOnTheScreen();
  });
});
