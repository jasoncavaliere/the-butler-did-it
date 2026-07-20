/**
 * The organizer authentication seam (Engineering Contract 7.4, client side).
 *
 * The organizer is the product's only authenticated user (D-2, D-3);
 * participants never authenticate. To keep the UI IdP-agnostic - mirroring the
 * generic server (`AddJwtBearer` over any OIDC issuer) and the `IStoreConnector`
 * philosophy - sign-in flows through this thin OIDC/PKCE provider seam rather
 * than any Entra-specific SDK. Entra External ID is the first and only v1
 * implementation; swapping IdP later is a config + single-provider-class change.
 */

/** The identity of the signed-in organizer, distilled from the IdP token. */
export type OrganizerIdentity = {
  /** Stable subject/object id (the `oid`/`sub` claim). */
  subject: string;
  /** Human display name shown in the UI. */
  name: string;
};

/** An established organizer session: who they are plus the bearer token. */
export type OrganizerSession = {
  organizer: OrganizerIdentity;
  /**
   * Bearer token for organizer-policy API calls. `null` in dev mode: the F6
   * dev handler auto-authenticates every request, so no token is needed and
   * none is committed.
   */
  token: string | null;
};

/**
 * The IdP-agnostic sign-in seam. A concrete provider is selected by
 * configuration (see {@link createAuthProvider}); tests inject a fake provider
 * through this same interface, proving the seam is real.
 */
export interface IAuthProvider {
  /** Discriminates the concrete provider (e.g. `dev`, `entra`) for diagnostics. */
  readonly kind: string;
  /**
   * Begin or complete an organizer sign-in. Resolves an
   * {@link OrganizerSession} once the session is established, or `null` when a
   * browser redirect was started and the page is navigating away (the session
   * completes on the return trip through the callback URL).
   */
  signIn(): Promise<OrganizerSession | null>;
  /** End the organizer session (client side); safe to call when signed out. */
  signOut(): Promise<void>;
}
