import { createDevAuthProvider, DEV_ORGANIZER_SESSION } from './devAuthProvider';

describe('createDevAuthProvider', () => {
  it('identifies as the dev provider', () => {
    expect(createDevAuthProvider().kind).toBe('dev');
  });

  it('signs in as the deterministic dev organizer with no token', async () => {
    const session = await createDevAuthProvider().signIn();
    expect(session).toEqual(DEV_ORGANIZER_SESSION);
    expect(session?.token).toBeNull();
    expect(DEV_ORGANIZER_SESSION.organizer.name).toBe('Development Organizer');
  });

  it('accepts a custom session override', async () => {
    const custom = { organizer: { subject: 's', name: 'Custom' }, token: 'tok' };
    const session = await createDevAuthProvider(custom).signIn();
    expect(session).toEqual(custom);
  });

  it('sign-out resolves without throwing', async () => {
    await expect(createDevAuthProvider().signOut()).resolves.toBeUndefined();
  });
});
