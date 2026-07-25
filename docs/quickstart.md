# Quickstart — mirror a scene into Vellum

`scripts/mirror-scene.mts` mirrors one scene (workspace → project → sequence →
shots) into Vellum from a **manifest**, retro-registers its locked selects as
completed versions (stamped with provider + provenance), sets shot statuses, and
writes a **per-shot pipeline log** generated from Vellum's append-only
provenance. It works for any scene from any backend; the manifest is the only
input.

Use it to seed a demo, or to bring an existing folder of approved renders under
provenance tracking without regenerating anything.

## Run it

```bash
# Dry run — validate the manifest + select files, register nothing:
npx tsx scripts/mirror-scene.mts path/to/scene.json --db ./vellum.db --dry-run

# Real run:
npx tsx scripts/mirror-scene.mts path/to/scene.json --db ./vellum.db
```

Flags:

- `--db <path>` — the SQLite database (default `./vellum.db`). Auto-created with
  WAL + schema if missing.
- `--dry-run` — parse + validate + stat the select files, then print what would
  happen. No database writes, no file copies.
- `--force` — re-register selects even when their `externalJobRef` already
  appears as a version's job id (see idempotency below).

The script is **idempotent**. Hierarchy is get-or-created by name; a status is
only transitioned when it actually differs (the status log is append-only, so
re-runs never pile up redundant transitions); and a select that is already
registered is skipped. "Already registered" is matched against **completed**
versions only (a prior run that failed mid-ingest is retried, not skipped) —
keyed on `externalJobRef` when present, else on the resolved filename. Run it
again as new selects are locked. `--force` re-registers every select, minting a
new version each time; use it only to deliberately create additional takes.

## What happens to the files

Each select is **copied** into Vellum's structured output tree at
`<outputRoot>/<project>/<sequence>/<shot>/<version>/<filename>` — the original
files are untouched, and Vellum owns a provenance-tracked copy. Point
`outputRoot` at a synced folder to keep the copies (and the generated
`pipeline-log.md` per shot) in a shared drive.

## Manifest reference

```jsonc
{
  "workspace": "Demo Show",              // Vellum workspace (the show)
  "project": "DEMO01",                    // project (the episode)
  "sequence": "SEQ010",                   // sequence (the scene)
  "outputRoot": "./out",                  // where Vellum writes copies + logs
                                          //   (relative to the manifest file)
  "ingestMaxBytes": 1073741824,           // optional — default is 500 MiB; raise for larger video selects
  "shots": [
    {
      "name": "sh010",                    // must match ^sh\d{3,}$ (shots by 10s)
      "status": "approved",               // optional: wip | pending-review |
                                          //   approved | on-hold | omit
      "statusNote": "keeper picked",      // optional
      "selects": [
        {
          "file": "renders/seq010/sh010_v003.png",  // abs, or relative to the manifest
          "provider": "google-ai-studio",  // provider id stamped on the version
          "filename": "DEMO01_SEQ010_SH010_F01_BG_AtriumWide_AD_v003_styled.png",
                                            // optional — defaults to the basename
          "provenance": { "stage": "STYLE", "base_model": "nano-banana" },
                                            // optional neutral provenance, stored
                                            //   verbatim in the completed event
          "notes": "locked select",        // optional version notes
          "externalJobRef": "gais_abc123"  // optional provider media UUID —
                                            //   the idempotency key
        }
      ]
    }
  ]
}
```

Pre-flight (before any write): every select file must exist and, when
`ingestMaxBytes` is set, fit the cap. A bad manifest fails fast so it never
leaves a half-mirrored scene.

## Hierarchy mapping

| Production concept               | Vellum                                      |
|----------------------------------|---------------------------------------------|
| Show                             | workspace                                   |
| Episode / project                | project                                     |
| Scene                            | sequence                                    |
| Shot (by 10s)                    | shot (`shXXX`)                              |
| Take / locked select            | version (completed, stamped with provider)  |
| Provider media UUID              | version `job_id` (from `externalJobRef`)    |
| Pipeline-log markdown            | `shot pipeline_log` action / this script    |

Set each `selects[].provider` to whichever backend produced the asset
(`comfyui-cloud`, `replicate`, `fal`, `byteplus`, `google-ai-studio`). Vellum
records it on the version so the lineage stays honest across a mixed-provider
pipeline.

## After mirroring

- Regenerate a shot's log any time: `{ tool: "shot", action: "pipeline_log",
  id: "<shot id>" }` — or re-run this script (it rewrites every `pipeline-log.md`).
- The log carries the status timeline, every take (provider, lineage, cost,
  outputs, neutral provenance), and any gated calls that produced no take
  (rejected / pending / approved-but-failed), so nothing spent goes unlogged.
