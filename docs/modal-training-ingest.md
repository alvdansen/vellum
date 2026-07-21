# Modal training-output ingest

Push checkpoint sample outputs from a fine-tuning run (e.g. a LoRA training job on
[Modal](https://modal.com)) directly into Vellum — organized, provenance-tracked,
and browsable in the dashboard — **without hosting them at public URLs first**.

The training script POSTs each checkpoint's sample images as a multipart upload to

```
POST /webhooks/modal/upload
Authorization: Bearer $VELLUM_INGEST_TOKEN
Content-Type: multipart/form-data
```

The bytes go straight into the version's output directory (atomic write, same path
machinery as every other output). Stored outputs carry the literal URL
`uploaded:direct` so you can always tell an uploaded asset from a fetched one.

> The route is **disabled (503) until `VELLUM_INGEST_TOKEN` is set** in the server
> environment, and every request must carry it as a bearer token. Whole-request
> cap: 64 MB. 1–20 files per request.

## Organization convention for fine-tune runs

Map the training effort onto Vellum's hierarchy so the dashboard shot grid reads
as *training progression per eval prompt*:

| Vellum entity | Fine-tune meaning | Example |
| --- | --- | --- |
| **project** | the fine-tune effort | `hh-style-lora` |
| **sequence** | one training run | `run-2026-07-21a` |
| **shot** | one **fixed eval prompt** | `prompt_fox_portrait` |
| **version** | that prompt's sample at each checkpoint | `v001` = step 100, `v002` = step 200, … |

Because each shot is a fixed prompt sampled at every checkpoint, opening a shot in
the dashboard shows the same prompt evolving as training progresses — and the shot
grid compares prompts side by side at a glance.

Create the hierarchy once (via the MCP tools or your setup script), then reuse the
shot ids at every checkpoint callback.

## Recommended provenance payload

Send the training state with every upload so each version is reproducible and
diffable (`version diff` works across any two checkpoints):

```json
{
  "base_model": "black-forest-labs/FLUX.1-dev",
  "dataset_rev": "style-v1@9f3ac21",
  "step": 1200,
  "lr": 0.0001,
  "loss": 0.1873,
  "params": { "rank": 16, "alpha": 32, "batch_size": 4, "resolution": 1024 }
}
```

## The upload request

Two form fields:

- `meta` — required JSON **text** field:
  `{ "shot_id": "<required>", "provenance": {…}, "external_job_ref": "…", "notes": "…" }`
- `files` — 1..20 **file** parts (the sample images/videos themselves)

Returns `201` with the same `{ entity, breadcrumb }` envelope as the MCP
`generation register` action; the new version is `completed`, stamped with
provider `modal` (taken from the URL path).

### Ready-to-paste Python for a Modal training script

Stdlib + `requests` only — call `push_checkpoint_samples` at each checkpoint:

```python
import json
import os
from pathlib import Path

import requests

VELLUM_URL = os.environ["VELLUM_URL"]            # e.g. "https://vellum.example.com"
VELLUM_INGEST_TOKEN = os.environ["VELLUM_INGEST_TOKEN"]


def push_checkpoint_samples(
    shot_id: str,
    sample_paths: list[Path],
    *,
    step: int,
    loss: float,
    lr: float,
    base_model: str,
    dataset_rev: str,
    run_id: str,
    params: dict | None = None,
) -> dict:
    """Upload one eval prompt's checkpoint samples into Vellum as a new version."""
    meta = {
        "shot_id": shot_id,
        "external_job_ref": run_id,
        "notes": f"checkpoint step {step}",
        "provenance": {
            "base_model": base_model,
            "dataset_rev": dataset_rev,
            "step": step,
            "lr": lr,
            "loss": loss,
            "params": params or {},
        },
    }
    files = [("meta", (None, json.dumps(meta)))]
    for p in sample_paths:
        suffix = p.suffix.lower()
        content_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".mp4": "video/mp4",
        }.get(suffix, "application/octet-stream")
        files.append(("files", (p.name, p.read_bytes(), content_type)))

    resp = requests.post(
        f"{VELLUM_URL}/webhooks/modal/upload",
        headers={"Authorization": f"Bearer {VELLUM_INGEST_TOKEN}"},
        files=files,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


# In your training loop, e.g. every N steps:
#
#   for shot_id, prompt in EVAL_PROMPTS.items():        # fixed prompts = shots
#       samples = sample_model(pipeline, prompt, out_dir / f"step_{step:06d}")
#       push_checkpoint_samples(
#           shot_id,
#           samples,
#           step=step,
#           loss=running_loss,
#           lr=optimizer.param_groups[0]["lr"],
#           base_model="black-forest-labs/FLUX.1-dev",
#           dataset_rev="style-v1@9f3ac21",
#           run_id="run-2026-07-21a",
#           params={"rank": 16, "alpha": 32},
#       )
```

### curl equivalent

```bash
curl -sS -X POST "$VELLUM_URL/webhooks/modal/upload" \
  -H "Authorization: Bearer $VELLUM_INGEST_TOKEN" \
  -F 'meta={"shot_id":"<SHOT_ID>","external_job_ref":"run-2026-07-21a","provenance":{"base_model":"black-forest-labs/FLUX.1-dev","dataset_rev":"style-v1@9f3ac21","step":1200,"lr":0.0001,"loss":0.1873,"params":{"rank":16,"alpha":32}}};type=application/json' \
  -F 'files=@ckpt_001200_sample.png;type=image/png'
```

Repeat `-F 'files=@…'` for up to 20 files per request.

## Already have public URLs?

If the run writes its samples somewhere with public https URLs (an allowlisted
delivery host), the JSON route does the same registration by reference:
`POST /webhooks/:provider` with
`{ shot_id, outputs: [{ url, filename?, content_type? }], provenance?, … }`.
Both routes and the MCP `generation register` action converge on the identical
engine path — see the `vellum://output-contract` MCP resource for the full schema.

## Dataset curation layer

Asset **tags + metadata** and the `asset query` action are the curation layer on
top of ingested samples. Tag keeper versions (e.g. `dataset:style-v1`,
`quality:reject`) as you review the grid, then pull a curated set back out by
tag with `{ tool: 'asset', action: 'query', tags: ['dataset:style-v1'] }` — for
example to assemble the next training round's dataset from the best previous
outputs.
