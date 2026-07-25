/**
 * VersionDrawerHost — backward-compat shim (Phase 22 / Plan 22-04).
 *
 * The Phase 21 component body now lives inside views/OverlayHost.tsx as
 * `VersionDrawerHostInternal`. OverlayHost is the public mount host and
 * branches on the `activeOverlay` discriminator (D-02 mutex with the new
 * Phase 22 ReviewPanel). When `activeOverlay === null && selectedVersionId
 * !== null` (the legacy direct-mutation flow Phase 21 callers use today),
 * OverlayHost renders the version drawer — so this re-export keeps
 * existing imports working with zero behavior change.
 *
 * Migration path: callers should eventually switch from
 *   import { VersionDrawerHost } from './views/VersionDrawerHost.js';
 * to
 *   import { OverlayHost } from './views/OverlayHost.js';
 * but the shim preserves backward compatibility for as long as needed.
 */
export { OverlayHost as VersionDrawerHost } from './OverlayHost.js';
