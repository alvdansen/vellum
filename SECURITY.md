# Security

## Reporting a vulnerability

Email **timothy@promptcrafted.com** with "Vellum security" in the subject. Please
do not open a public issue for anything exploitable. Include what you did, what
happened, and what you expected — a proof of concept helps but is not required.

There is no bounty programme. Reports are read by a person, not a queue.

## What Vellum is exposed to

Vellum is a local, single-process MCP server. The HTTP surface binds `127.0.0.1`
and is not intended to be put on a network interface. That is the assumption
behind most of what follows — if you deploy it differently, the threat model is
yours to redo.

Three trust boundaries carry most of the risk:

**Provider-delivered bytes.** Generation outputs are downloaded from provider
delivery hosts and written to disk, then decoded for thumbnails and signing.
Nothing upstream constrains file *content* — the size cap, the https requirement
and the SSRF guards all constrain where bytes came from, not what they are. An
image decoder vulnerability is therefore reachable with attacker-influenced
input, which is why the `sharp` version below is treated as security-relevant
rather than routine.

**Caller-supplied ingest URLs.** `generation register` fetches an output by URL.
The host allowlist includes shared object stores that anyone can write to, so an
agent that can be talked into ingesting a chosen URL controls the bytes.

**Agent-supplied everything else.** Prompts, names, workflow JSON and metadata
all arrive from an LLM that may itself be operating on untrusted input.

## Outbound request controls

Every outbound fetch of a URL Vellum did not fully choose itself passes:

- **https only** — no plaintext, no `file:`, no `data:`.
- **A host allowlist** — built-in delivery hosts plus whatever the operator adds
  via the `*_ALLOWED_OUTPUT_HOSTS` / `VELLUM_INGEST_ALLOWED_HOSTS` variables.
- **A resolved-address check** — the allowlist answers "do we trust this name?";
  this answers "and where does that name point?". Any answer in loopback,
  link-local (including `169.254.169.254`), RFC1918, CGNAT or the IPv6
  equivalents is refused, and a host that returns one public and one private
  address is refused too. This is check-then-connect, not true pinning: a record
  whose TTL expires between the check and the connection could resolve
  differently. Closing that fully needs a custom dispatcher that dials the
  checked IP while carrying the hostname for TLS. What is here defeats the
  realistic attack — a hostile or compromised delivery host pointing inward.
- **`redirect: 'manual'`** — a 3xx from a delivery host is refused rather than
  followed, so a redirect cannot walk out of the allowlist.
- **A byte cap and an idle timeout** — a wedged socket cannot hold a slot for the
  life of the process.

Inbound, the HTTP surface checks both `Origin` and `Host` on every route, which
is what stops a web page resolving a hostname to `127.0.0.1` from driving the
local server.

## Known advisories

`npm audit --omit=dev` reports entries that Vellum's own code cannot reach. They
are listed here so you do not have to work that out yourself, and so it is
obvious if the situation ever changes.

### Reachable — kept current

| Package | Why it matters |
| --- | --- |
| `sharp` / libvips | Decodes provider-delivered bytes on the thumbnail path. Pinned to a release whose bundled libvips carries no known decoder CVE. `format-router-sniffing.test.ts` asserts the libvips floor so a lockfile change cannot silently walk it back. |
| `hono` | Serves the HTTP surface. Kept current; the CORS origin-reflection advisory in particular overlaps Vellum's own origin guard. |

Note that Vellum's extension table (`src/engine/thumbnails/format-router.ts`) is
**routing, not a security boundary** — libvips picks its decoder by sniffing
content, so restricting extensions does not restrict which decoders run. Keeping
`sharp` current is the control; the table is not.

### Not reachable — documented, not chased

**`c2pa-node` build tooling.** `c2pa-node@0.5.26` declares `@changesets/cli`,
`npm-run-all` and `cargo-cp-artifact` as runtime `dependencies` rather than dev
dependencies. That is an upstream packaging bug, and it is where `shell-quote`
(critical), `js-yaml` and `brace-expansion` come from. None of it is loaded:

```bash
grep -rhoE 'require\("[^"]+"\)' node_modules/c2pa-node/dist/
# → sharp, pkg-dir, and node: builtins. Nothing else.
```

`npm audit fix` proposes `c2pa-node@0.1.0` here, which is a downgrade past the
signer API the engine depends on. Do not take it.

**The MCP SDK's Express transport.** `fast-uri`, `ip-address`,
`express-rate-limit`, `body-parser` and `qs` arrive via
`@modelcontextprotocol/sdk`'s Express-based Streamable HTTP transport. Vellum
does not use it — it runs Hono with the SDK's web-standard transport
(`WebStandardStreamableHTTPServerTransport`). The same applies to the older
`@hono/node-server` nested under the SDK: the top-level copy Vellum actually
uses is current, and the nested one is only reachable through the Express
transport. Forcing an override into the SDK's nested tree is riskier than the
advisory it would silence.

## Cryptographic material

C2PA signing is off unless both a certificate and a private key are configured.
The development certificate generated by `scripts/gen-dev-c2pa-cert.mts` is
self-signed: a manifest signed with it verifies for you and means nothing to
anyone else. Do not ship it.

Signing key paths are constrained to a directory root (`VELLUM_C2PA_CERT_ROOT`,
defaulting to the working directory) so a misconfiguration cannot read an
arbitrary file off disk.

## What is deliberately not defended

- **Multi-tenancy.** There is no authentication and no authorisation. Anyone who
  can reach the HTTP port or the stdio pipe has full access to everything in the
  database.
- **The operator's own allowlist additions.** Adding a host to
  `*_ALLOWED_OUTPUT_HOSTS` is a trust decision. The resolved-address check still
  applies, but the name check is yours to get right.
- **Cost accounting as a billing control.** `record_cost` records what it is
  told. `VELLUM_SPEND_LIMIT` is a backstop against a runaway loop, not a
  guarantee about your provider invoice.
