import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PersonFields, type PersonDraft } from './PersonFields';
import { claimColors } from '../theme/theme';

const DRAFT: PersonDraft = { displayName: 'Alex', isChild: false, claimColor: '#123456' };

async function renderFields(value: PersonDraft = DRAFT) {
  const onChange = jest.fn();
  await render(<PersonFields value={value} onChange={onChange} />);
  return onChange;
}

describe('PersonFields', () => {
  it('shows the draft: name, child switch, and no swatch selected for a non-preset colour', async () => {
    await renderFields();

    expect(screen.getByTestId('input-person-name').props.value).toBe('Alex');
    expect(screen.getByTestId('input-person-child').props.value).toBe(false);
    for (const color of claimColors) {
      expect(screen.getByTestId(`claim-color-${color.name}`).props.accessibilityState).toEqual({
        selected: false,
      });
    }
    expect(screen.queryByText(/role/i)).toBeNull();
  });

  it('marks the swatch whose dark variant is the stored colour as selected', async () => {
    const blue = claimColors.find((color) => color.name === 'blue')!;
    await renderFields({ ...DRAFT, claimColor: blue.dark });

    expect(screen.getByTestId('claim-color-blue').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('claim-color-blue').props.accessibilityLabel).toBe('blue');
    expect(screen.getByTestId('claim-color-grass').props.accessibilityState).toEqual({ selected: false });
  });

  it('hands the merged draft to onChange for a name, child, or colour change', async () => {
    const onChange = await renderFields();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('input-person-name'), 'Alexis');
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, displayName: 'Alexis' });

    await act(async () => {
      fireEvent(screen.getByTestId('input-person-child'), 'valueChange', true);
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, isChild: true });

    const grass = claimColors.find((color) => color.name === 'grass')!;
    await act(async () => {
      fireEvent.press(screen.getByTestId('claim-color-grass'));
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, claimColor: grass.dark });
  });
});
