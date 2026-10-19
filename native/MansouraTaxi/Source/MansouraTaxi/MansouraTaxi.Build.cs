using UnrealBuildTool;
public class MansouraTaxi : ModuleRules {
    public MansouraTaxi(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] {
            "Core", "CoreUObject", "Engine", "InputCore", "PhysicsCore",
            "Json", "JsonUtilities", "ProceduralMeshComponent", "UMG", "Slate", "SlateCore"
        });
    }
}
