/**
 * Product identity.
 *
 * Placeholder branding lives here so renaming is a single-file change. After
 * editing APP_NAME, mirror it in app.json (`expo.name` and `expo.slug`) so the
 * launcher label and the Expo Go entry match.
 */
export const APP_NAME = 'Counter';

export const APP_TAGLINE = 'Tell it what you do. It builds the software.';

/**
 * Where a person writes when the app cannot resolve something itself.
 *
 * Google Play requires a route to account deletion that does not depend on
 * having the app installed, and Clerk can refuse a self-deletion if the
 * instance forbids it — both paths end at a human, so the address is defined
 * once here and used by the app and the public deletion page alike.
 *
 * Change this before the first store submission. It has to be an address that
 * is actually read: the Play listing points at it, and a deletion request that
 * goes nowhere is a policy breach rather than an inbox problem.
 */
export const SUPPORT_EMAIL = 'anshtyagi0404@gmail.com';
