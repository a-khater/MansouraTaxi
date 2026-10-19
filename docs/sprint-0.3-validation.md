# Sprint 0.3 validation — 19 October 2026

## Passed

- `npm.cmd test`: **70 passed, 0 failed**. Includes legal routing between all 19 destinations, four independent passenger payments, vehicle/building collisions, university street-life placement and walk transforms, original native asset geometry/provenance, and the reproduced canal bridge approach regression.
- `npm.cmd run build`: static browser output produced in `dist/`.
- `git diff --check`: no whitespace errors.
- Python AST, native JSON/project JSON and both PowerShell tool scripts parsed successfully.
- Connected Chrome: loaded the local world without captured console errors/warnings; opened the requested destination list, selected Touril and obtained an Arabic objective/route; started a taxi shift and asked a passenger's destination; checked compact desktop and 390×844 phone presentation; Tab removed optional HUD. Screenshots saved under ignored `artifacts/`.

The water collision fix preserves original road/water polygons and clears only bridge and directly connected approach corridors. Both sides of OSM bridge 765698815 are now accessible instead of ending at flat collision caps inside the source canal.

## Not passed / not attempted

- **Unreal build/runtime:** engine installation is absent. Running the build preflight reports “Unreal Engine is not configured … No native build has run.” Windows PowerShell's file execution policy also blocks direct `.ps1` invocation on this device; parsing and the preflight script body were checked without changing that policy. No UHT/C++ compilation, editor asset import, cooking, native executable, performance benchmark or streamed session exists.
- **Hardware target:** about 32 GiB RAM, Radeon 530 and UHD 620. The GPUs do not meet the requested Lumen-quality target. No GPU host is connected; no paid resource was provisioned.
- **Visual identity:** 2,697 mapped footprints are geographic geometry, not matching facades. Three structures are photo-referenced and none are survey-verified. Governorate, stadium, courts, hospitals and clubs have location evidence/estimated road stops but are not complete individual building models. No 99% similarity claim is supported.
- **Audio:** original synthesized browser traffic/ambience and optional system Arabic speech are implemented. Availability/quality of an Egyptian voice, actual recorded performances, full native spatial audio and streamed sound remain unverified or unimplemented.
- **Driving QA:** browser UI/visual smoke checks and deterministic driving simulations passed; a sustained hands-on drive on this device, an entire shared-taxi journey, native handling calibration and performance measurements remain required. Screenshots are browser prototype output, not UE output.

Follow-up issue drafts with scope and acceptance criteria are in `docs/next-sprint-issues.json`. They cover actual UE build/runtime, GPU streaming, facade surveys/landmark reconstruction, Verna rig/handling, native gameplay parity, audio and dense street-life performance.

## Delivery checks

The browser update is published at https://mansoura-taxi-open-world.cherrytrail953938.chatgpt.site with owner-private access preserved. The published map visibly includes the governorate, stadium and El Geish court destinations; choosing the courts produced an Arabic objective and road route without captured console warnings/errors. The final mobile HUD removes the overlapping camera label. These remain browser prototype checks.

All eight follow-up issues were created and verified in [a-khater/MansouraTaxi](https://github.com/a-khater/MansouraTaxi/issues), numbered 1–8. The source is committed and pushed to the Site repository. A direct push to the separate GitHub origin failed because its saved credentials are invalid; the signed-in browser's upload attempt was also blocked by the extension's file-URL permission. GitHub source synchronization therefore remains pending authentication or upload access. A complete verified Git bundle is available locally under ignored `artifacts/` for handoff.

Native provenance was also compared with the actual committed Git blobs. An existing CRLF JSON source discrepancy was corrected and `.gitattributes` pins source line endings to LF so fresh Windows/Linux checkouts preserve those hashes. All six native asset tests passed again after re-export.
