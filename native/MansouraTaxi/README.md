# Mansoura Taxi — Unreal source prototype

UE 5.6 C++ project for Windows with Pixel Streaming 2. **Not yet compiled, packaged or played in Unreal.** No native executable or working streaming endpoint is included. The published browser game remains a separate Three.js prototype.

## Included

- Chaos rigid-body taxi with four trace-wheel suspension contacts, friction limits, front-wheel drive, automatic gears, reverse, handbrake and chase camera. Parameters are engineering estimates, not measured Hyundai handling data.
- Original Verna-inspired mesh and three photo-referenced building models, exported as OBJ/MTL/PNG source assets. The vehicle is a single static mesh, not a finished independently animated wheel/suspension rig.
- The browser's expanded OSM road network, 2,697 mapped building footprints, river cutout, attributed geographic data and 19 destinations. Most building heights and all generic facade appearances remain inferred. Three individually referenced models are not survey-verified.
- Ambient road traffic, microbuses, university crowds and interpreted shoe/scarf stands. These are fictional population and placement, not a census or vendor survey.
- A first four-rider gameplay loop: ask, accept/refuse, discuss sharing, board/drop off and separate payments. Native destination selection currently uses straight-line distance; road navigation, full browser negotiation and patience behavior still require porting.
- Small transparent corner HUD with Arabic text shaping, a synthesized horn and original text lines. Native Egyptian voice performances and a complete spatial street soundscape are not implemented.

## Build on a suitable Windows host

Install an engine-supported Visual Studio 2022 C++ toolchain and Windows SDK, plus UE 5.6. Accept Epic's license yourself. This project does not download the engine or create paid cloud resources.

```powershell
.\Tools\build-native.ps1 -EngineRoot 'D:\Epic Games\UE_5.6' -PreflightOnly
.\Tools\build-native.ps1 -EngineRoot 'D:\Epic Games\UE_5.6'
```

The helper compiles the Editor target, runs `bootstrap_editor.py` to import the original meshes/materials and generate `/Game/Mansoura/Maps/Mansoura`, validates a fresh import report, then cooks/packages Win64. Imported `.uasset`/`.umap` files and build outputs are ignored by Git. `Content/Data` is staged as non-UFS data. A successful package writes `Packaged/native-build.json`; preflight alone never reports a successful build.

Source coordinates are metres (x east, z south). Unreal coordinates are centimetres (X north, Y east, Z up). The exporter applies this transform and corrects triangle winding. Do not enable a second OBJ scene/unit conversion during import. The bootstrap checks mesh dimensions against `Content/Data/reference-assets.json`.

To regenerate original mesh exports from the repository root, install `@napi-rs/canvas` in a tooling directory, set `NATIVE_CANVAS_MODULE` to that package's `index.js`, and run `npm.cmd run export:native`. Existing source OBJ/PNG files are already supplied; this step is needed only after changing their source models or map provenance.

## Browser streaming

Use the [official Epic infrastructure](https://github.com/EpicGamesExt/PixelStreamingInfrastructure) branch matching the packaged engine version. Prepare its dependencies and an explicitly loopback-bound signalling service/frontend on the GPU host, then:

```powershell
.\Tools\start-stream.ps1 -PackagedExe '.\Packaged\Windows\MansouraTaxi.exe' -InfrastructureRoot 'D:\PixelStreamingInfrastructure' -PreflightOnly
.\Tools\start-stream.ps1 -PackagedExe '.\Packaged\Windows\MansouraTaxi.exe' -InfrastructureRoot 'D:\PixelStreamingInfrastructure'
```

This helper requires the package hash/build metadata and existing listeners on 127.0.0.1:8080/8888. Epic UE5.6's `--public_ip` does not restrict interface binding; configure that branch's bindings before starting its server. The helper verifies interfaces rather than silently opening public ports. It starts the game hidden with offscreen rendering and an audio mixer; it does not provision a host, install signalling, configure remote authentication/TURN or publish a cloud stream. Observe browser video, audio and controls separately before calling streaming verified.

This device has about 32 GiB RAM, Radeon 530 and Intel UHD 620 graphics. It does not meet the requested Lumen-quality graphics target and no Unreal installation was found. No GPU cloud host is connected. Ordinary [Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) are code-execution environments; the available default specifications do not provide this project with a provisioned Windows GPU streaming host.

See [Epic hardware requirements](https://dev.epicgames.com/documentation/en-us/unreal-engine/hardware-and-software-specifications-for-unreal-engine) and [Pixel Streaming setup](https://dev.epicgames.com/documentation/unreal-engine/getting-started-with-pixel-streaming-in-unreal-engine?lang=en-US).

## Controls

WASD/arrows drive; Ctrl brake; Space handbrake; H horn; R recover; M next destination; F ask; 1 accept; 3 refuse; 4 discuss sharing; E board/drop off while stopped; Tab compact HUD; Escape pause (standalone).

## Acceptance still pending

UHT/C++ compilation, editor import, cooking, GPU performance, physical handling/playability, Arabic font fallback, collision and crowd behavior in Unreal, and streamed video/audio/input all require real engine validation. Changing engine alone does not supply identical Mansoura buildings. Current source models and generic footprint extrusion do **not** satisfy 99% visual similarity.
