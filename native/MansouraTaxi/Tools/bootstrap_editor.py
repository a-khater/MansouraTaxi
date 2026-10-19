"""Run in UnrealEditor-Cmd, never in system Python.

Imports the original centimetre-space OBJ exports and their authored material
metadata. No reference photograph is imported. UE 5.6 Python API references:
https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/FbxStaticMeshImportData?application_version=5.6
https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MaterialEditingLibrary?application_version=5.6
https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/LevelEditorSubsystem?application_version=5.6
"""

import hashlib
import json
import math
import os
from pathlib import Path
import re
import traceback

import unreal


PROJECT = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())).resolve()
MANIFEST = PROJECT / "Content" / "Data" / "reference-assets.json"
REPORT = PROJECT / "Saved" / "Native" / "bootstrap-result.json"
MAP = "/Game/Mansoura/Maps/Mansoura"
MATERIAL_ROOT = "/Game/Mansoura/Materials"
ASSETS = unreal.AssetToolsHelpers.get_asset_tools()
EDITOR_ASSETS = unreal.EditorAssetLibrary
MATERIALS = unreal.MaterialEditingLibrary
TEXTURES = {}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save_asset(asset):
    require(EDITOR_ASSETS.save_loaded_asset(asset, only_if_is_dirty=False),
            "Could not save " + asset.get_path_name())


def source_file(relative):
    candidate = (PROJECT / relative).resolve()
    require(candidate.is_relative_to(PROJECT / "SourceAssets"),
            "Source asset escapes SourceAssets: " + str(relative))
    require(candidate.is_file(), "Missing exported source asset: " + str(candidate))
    return candidate


def asset_name(package):
    require(re.fullmatch(r"/Game/Mansoura/[A-Za-z0-9_/]+", package) is not None,
            "Invalid generated asset package: " + str(package))
    return package.rsplit("/", 1)


def material_asset(package):
    folder, name = asset_name(package)
    material = EDITOR_ASSETS.load_asset(package) if EDITOR_ASSETS.does_asset_exist(package) else None
    if material is None:
        EDITOR_ASSETS.make_directory(folder)
        material = ASSETS.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    require(isinstance(material, unreal.Material), "Expected material at " + package)
    MATERIALS.delete_all_material_expressions(material)
    return material


def node(material, kind, x=0, y=0, **properties):
    result = MATERIALS.create_material_expression(material, kind, x, y)
    require(result is not None, "Could not create material expression " + str(kind))
    for name, value in properties.items():
        result.set_editor_property(name, value)
    return result


def connect(expression, prop, output=""):
    require(MATERIALS.connect_material_property(expression, output, prop),
            "Could not connect material property " + str(prop))


def multiply(material, a, b, a_output="", b_output=""):
    result = node(material, unreal.MaterialExpressionMultiply, -160, 0)
    require(MATERIALS.connect_material_expressions(a, a_output, result, "A"), "Missing multiply input A")
    require(MATERIALS.connect_material_expressions(b, b_output, result, "B"), "Missing multiply input B")
    return result


def color(values):
    require(len(values) == 3 and all(math.isfinite(float(value)) for value in values),
            "Material color must contain three finite linear components")
    return unreal.LinearColor(*[float(value) for value in values], 1.0)


def prototype_material():
    material = material_asset(MATERIAL_ROOT + "/M_Prototype")
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    for name, kind, default, prop, y in (
        ("Color", unreal.MaterialExpressionVectorParameter, unreal.LinearColor(.5, .5, .5, 1),
         unreal.MaterialProperty.MP_BASE_COLOR, 0),
        ("Roughness", unreal.MaterialExpressionScalarParameter, .85,
         unreal.MaterialProperty.MP_ROUGHNESS, 200),
        ("Emissive", unreal.MaterialExpressionVectorParameter, unreal.LinearColor(0, 0, 0, 1),
         unreal.MaterialProperty.MP_EMISSIVE_COLOR, 400),
    ):
        expression = node(material, kind, -350, y, parameter_name=name, default_value=default)
        connect(expression, prop)
    MATERIALS.set_material_usage(material, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    MATERIALS.recompile_material(material)
    require(MATERIALS.has_material_usage(material, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES),
            "Prototype material is missing its cooked instanced-mesh shader usage")
    require({"Color", "Emissive"}.issubset({str(name) for name in MATERIALS.get_vector_parameter_names(material)})
            and "Roughness" in {str(name) for name in MATERIALS.get_scalar_parameter_names(material)},
            "Prototype material parameters do not match the C++ city contract")
    save_asset(material)
    return material.get_path_name()


def import_texture(entry, filename):
    source = source_file(str(Path(entry["obj"]).parent / filename))
    key = str(source)
    if key in TEXTURES:
        return TEXTURES[key]
    mesh_name = entry["assetPath"].rsplit("/", 1)[1]
    destination = "/Game/Mansoura/Textures/" + mesh_name
    task = unreal.AssetImportTask()
    for name, value in {
        "filename": str(source), "destination_path": destination,
        "destination_name": source.stem, "automated": True,
        "replace_existing": True, "replace_existing_settings": True,
        "save": True, "async_": False,
    }.items():
        task.set_editor_property(name, value)
    ASSETS.import_asset_tasks([task])
    imported = task.get_objects()
    texture = next((asset for asset in imported if isinstance(asset, unreal.Texture2D)), None)
    require(texture is not None, "Texture import failed: " + str(source))
    texture.set_editor_property("srgb", True)
    # PNG alpha carries the original authored lettering; never drop it through MTL heuristics.
    texture.set_editor_property("compression_no_alpha", False)
    save_asset(texture)
    TEXTURES[key] = texture
    return texture


def reference_material(entry, info):
    mesh_name = entry["assetPath"].rsplit("/", 1)[1]
    material_id = info["id"]
    require(re.fullmatch(r"[A-Za-z0-9_]+", material_id) is not None, "Unsafe material ID")
    material = material_asset(MATERIAL_ROOT + "/" + mesh_name + "/M_" + material_id)
    opacity = float(info.get("opacity", 1))
    alpha_test = float(info.get("alphaTest", 0))
    require(math.isfinite(opacity) and 0 <= opacity <= 1, "Invalid material opacity")
    masked = alpha_test > 0
    translucent = not masked and (info.get("transparent", False) or opacity < 1)
    blend = (unreal.BlendMode.BLEND_MASKED if masked else
             unreal.BlendMode.BLEND_TRANSLUCENT if translucent else unreal.BlendMode.BLEND_OPAQUE)
    material.set_editor_property("blend_mode", blend)
    material.set_editor_property("two_sided", bool(info.get("doubleSided", False)))
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT
                                 if info.get("unlit", False) else unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    if masked:
        material.set_editor_property("opacity_mask_clip_value", alpha_test)
    samples = {}

    def sample(filename):
        if filename not in samples:
            samples[filename] = node(material, unreal.MaterialExpressionTextureSample, -650, 0,
                                     texture=import_texture(entry, filename),
                                     sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
        return samples[filename]

    base = node(material, unreal.MaterialExpressionConstant3Vector, -650, 180,
                constant=color(info.get("baseColorLinear", [1, 1, 1])))
    if info.get("baseColorTexture"):
        base = multiply(material, base, sample(info["baseColorTexture"]), b_output="RGB")
    if info.get("unlit", False):
        connect(base, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    else:
        connect(base, unreal.MaterialProperty.MP_BASE_COLOR)
        emissive = node(material, unreal.MaterialExpressionConstant3Vector, -650, 360,
                        constant=color(info.get("emissiveLinear", [0, 0, 0])))
        if info.get("emissiveTexture"):
            emissive = multiply(material, emissive, sample(info["emissiveTexture"]), b_output="RGB")
        connect(emissive, unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    for key, prop, default in (
        ("roughness", unreal.MaterialProperty.MP_ROUGHNESS, .8),
        ("metalness", unreal.MaterialProperty.MP_METALLIC, 0),
    ):
        value = float(info.get(key, default))
        require(math.isfinite(value) and 0 <= value <= 1, "Invalid PBR value " + key)
        connect(node(material, unreal.MaterialExpressionConstant, -300, 400, r=value), prop)
    if masked or translucent:
        alpha = node(material, unreal.MaterialExpressionConstant, -600, 600, r=opacity)
        if info.get("alphaTexture"):
            alpha = multiply(material, alpha, sample(info["alphaTexture"]), b_output="A")
        connect(alpha, unreal.MaterialProperty.MP_OPACITY_MASK if masked else unreal.MaterialProperty.MP_OPACITY)
    MATERIALS.layout_material_expressions(material)
    MATERIALS.set_material_usage(material, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    MATERIALS.recompile_material(material)
    save_asset(material)
    return material


def import_mesh(entry):
    folder, name = asset_name(entry["assetPath"])
    options = unreal.FbxImportUI()
    for key, value in {
        "is_obj_import": True, "automated_import_should_detect_type": False,
        "mesh_type_to_import": unreal.FBXImportType.FBXIT_STATIC_MESH,
        "original_import_type": unreal.FBXImportType.FBXIT_STATIC_MESH,
        "import_mesh": True, "import_as_skeletal": False,
        "import_animations": False, "import_materials": False, "import_textures": False,
        "override_full_name": True,
    }.items():
        options.set_editor_property(key, value)
    mesh_options = options.get_editor_property("static_mesh_import_data")
    for key, value in {
        "convert_scene": False, "convert_scene_unit": False,
        "force_front_x_axis": False, "import_uniform_scale": 1.0,
        "import_rotation": unreal.Rotator(0, 0, 0),
        "import_translation": unreal.Vector(0, 0, 0),
        "combine_meshes": True, "auto_generate_collision": False,
        "generate_lightmap_u_vs": False, "build_nanite": False,
        "normal_import_method": unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS,
        "transform_vertex_to_absolute": True, "bake_pivot_in_vertex": False,
        "reorder_material_to_fbx_order": True,
    }.items():
        mesh_options.set_editor_property(key, value)
    task = unreal.AssetImportTask()
    factory = unreal.FbxFactory()
    for key, value in {
        "filename": str(source_file(entry["obj"])), "destination_path": folder,
        "destination_name": name, "automated": True, "replace_existing": True,
        "replace_existing_settings": True, "save": False, "async_": False,
        "options": options, "factory": factory,
    }.items():
        task.set_editor_property(key, value)
    factory.set_editor_property("asset_import_task", task)
    ASSETS.import_asset_tasks([task])
    meshes = [asset for asset in task.get_objects() if isinstance(asset, unreal.StaticMesh)]
    require(len(meshes) == 1, "Expected one combined static mesh for " + entry["obj"])
    mesh = meshes[0]
    require(mesh.get_path_name() == entry["meshPath"], "Importer changed the expected mesh path")
    slots = list(mesh.get_editor_property("static_materials"))
    material_info = {item["id"].lower(): item for item in entry["materials"]}
    assigned = {}
    for index, slot in enumerate(slots):
        imported_name = str(slot.get_editor_property("imported_material_slot_name")).lower()
        slot_name = str(slot.get_editor_property("material_slot_name")).lower()
        material_id = imported_name if imported_name in material_info else slot_name
        require(material_id in material_info,
                "Unrecognized imported material slot: " + imported_name + " / " + slot_name)
        if material_id not in assigned:
            assigned[material_id] = reference_material(entry, material_info[material_id])
        mesh.set_material(index, assigned[material_id])
    require(slots and len(assigned) == len(material_info), "Imported material sections were lost or merged")
    mesh_editor = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    settings = mesh_editor.get_lod_build_settings(mesh, 0)
    settings.set_editor_property("recompute_normals", False)
    settings.set_editor_property("recompute_tangents", True)
    mesh_editor.set_lod_build_settings(mesh, 0, settings)
    body = mesh.get_editor_property("body_setup")
    require(body is not None, "Static mesh lacks collision body: " + entry["meshPath"])
    body.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
    body.set_editor_property("double_sided_geometry", True)
    # A convex hull across both arches would block the photographed Law Gate openings.
    mesh.set_editor_property("lod_for_collision", 0)
    bounds = mesh.get_bounding_box()
    for side, actual in (("min", bounds.min), ("max", bounds.max)):
        for axis, observed, expected in zip("xyz", (actual.x, actual.y, actual.z), entry["boundsCm"][side]):
            require(math.isfinite(observed) and abs(observed - expected) <= max(.5, abs(expected) * .0002),
                    "Axis/unit/bounds mismatch for " + name + " " + side + "." + axis)
    save_asset(mesh)
    return {"meshPath": mesh.get_path_name(), "materialSlots": len(slots),
            "collision": "complex-as-simple", "boundsVerifiedCm": True}


def main():
    require(MANIFEST.is_file(), "Missing Content/Data/reference-assets.json; run node scripts/export-native-assets.mjs first")
    raw = MANIFEST.read_bytes()
    manifest = json.loads(raw.decode("utf-8-sig"))
    require(manifest.get("coordinateSystem", {}).get("units") == "centimetres", "Expected centimetre exports")
    entries = manifest.get("entries", [])
    require(entries, "Reference asset manifest has no entries")
    for entry in entries:
        asset_name(entry["assetPath"])
        require(entry["meshPath"] == entry["assetPath"] + "." + entry["assetPath"].rsplit("/", 1)[1],
                "meshPath disagrees with assetPath")
        source_file(entry["obj"])
        source_file(entry["mtl"])
        require(entry.get("materials"), "Missing material metadata")
        for info in entry["materials"]:
            for key in ("baseColorTexture", "emissiveTexture", "alphaTexture"):
                if info.get(key):
                    source_file(str(Path(entry["obj"]).parent / info[key]))
    prototype = prototype_material()
    imported = [import_mesh(entry) for entry in entries]
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    EDITOR_ASSETS.make_directory("/Game/Mansoura/Maps")
    # Preserve an existing authored map. The initial blank map uses the C++ global
    # game mode, which spawns the city and taxi once at runtime.
    if EDITOR_ASSETS.does_asset_exist(MAP):
        require(levels.load_level(MAP), "Could not load existing Mansoura map")
    else:
        require(levels.new_level(MAP, is_partitioned_world=False), "Could not create blank Mansoura map")
    require(levels.save_current_level(), "Could not save Mansoura map")
    require(EDITOR_ASSETS.does_asset_exist(MAP), "Saved map is missing")
    return {"status": "success", "runId": os.environ.get("MANSOURA_BOOTSTRAP_RUN_ID", "manual"),
            "manifestSha256": hashlib.sha256(raw).hexdigest(), "map": MAP,
            "prototypeMaterial": prototype, "meshes": imported,
            "engineVersion": unreal.SystemLibrary.get_engine_version()}


try:
    result = main()
except Exception:
    result = {"status": "failed", "runId": os.environ.get("MANSOURA_BOOTSTRAP_RUN_ID", "manual"),
              "error": traceback.format_exc()}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    unreal.log_error(result["error"])
    raise
else:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    unreal.log("Mansoura content bootstrap completed: " + str(REPORT))
