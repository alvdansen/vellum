/**
 * VersionDrawerHost — backward-compat shim.
 *
 * The original component body now lives inside views/OverlayHost.tsx as
 * `VersionDrawerHostInternal`. OverlayHost is the public mount host and
 * branches on the `activeOverlay` discriminator (mutually exclusive with
 * the ReviewPanel overlay). When `activeOverlay === null && selectedVersionId
 * !== null` (the legacy direct-mutation flow existing callers use today),
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
