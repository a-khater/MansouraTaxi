#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MansouraCity.generated.h"

class UDirectionalLightComponent;
class USkyLightComponent;
class USkyAtmosphereComponent;
class UExponentialHeightFogComponent;
class UStaticMesh;
class USceneComponent;
struct FMansouraCityData;

USTRUCT(BlueprintType)
struct FMansouraCityDestination
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) FString Id;
    UPROPERTY(BlueprintReadOnly) FString Name;
    UPROPERTY(BlueprintReadOnly) FString Arabic;
    UPROPERTY(BlueprintReadOnly) FString Kind;
    UPROPERTY(BlueprintReadOnly) FString LocationStatus;
    UPROPERTY(BlueprintReadOnly) FVector Location = FVector::ZeroVector;
    UPROPERTY(BlueprintReadOnly) FTransform RoadAccess = FTransform::Identity;
    UPROPERTY(BlueprintReadOnly) bool bReachable = false;
};

/** Runtime rendering of the attributed OSM extract. Footprints are mapped;
 *  heights and proxy appearances are explicitly unverified. Imported reference
 *  meshes remain photo-based interpretations, not measured replicas.
 *
 *  Source metres (east x, south z) -> Unreal cm (-z*100, x*100, height*100).
 *  Keep this actor at the world origin; its generated geometry uses that frame.
 */
UCLASS()
class MANSOURATAXI_API AMansouraCity : public AActor
{
    GENERATED_BODY()

public:
    AMansouraCity();
    virtual ~AMansouraCity() override;
    virtual void Tick(float DeltaSeconds) override;

    UFUNCTION(BlueprintCallable, Category="Mansoura|World") bool LoadCity();
    UFUNCTION(BlueprintCallable, Category="Mansoura|World") void SetNight(bool bNight);
    UFUNCTION(BlueprintPure, Category="Mansoura|World") FTransform GetTaxiStart() const;
    UFUNCTION(BlueprintPure, Category="Mansoura|World") FBox GetCityBounds() const;
    UFUNCTION(BlueprintPure, Category="Mansoura|World") bool IsCityLoaded() const { return bCityLoaded; }
    UFUNCTION(BlueprintPure, Category="Mansoura|World") bool GetDestinationAccess(const FString& Id, FTransform& Access) const;

    /** XY clearance against literal footprints, inner courtyards, mapped water
     *  collision polygons (bridge cutouts retained), and the source boundary. */
    UFUNCTION(BlueprintPure, Category="Mansoura|World") bool IsLocationClear(FVector Location, float RadiusCm = 105.f) const;

    /** Closest legal direction on a mapped edge, checked with three Verna-sized
     *  circles. Returns false if no safe source geometry is within the radius. */
    UFUNCTION(BlueprintCallable, Category="Mansoura|World") bool FindNearestRoadPose(FVector Location, FTransform& Pose, float SearchRadiusCm = 12000.f) const;

    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") TArray<FMansouraCityDestination> Destinations;
    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") int32 MappedBuildingCount = 0;
    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") int32 ImportedReferenceCount = 0;
    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") int32 ConnectedTrafficEdgeCount = 0;
    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") FString AccuracyNotice;
    UPROPERTY(BlueprintReadOnly, Category="Mansoura|World") FString MapAttribution;

    UPROPERTY(EditAnywhere, Category="Mansoura|World") bool bAutoLoad = true;
    UPROPERTY(EditAnywhere, Category="Mansoura|World", meta=(ClampMin="0", ClampMax="140")) int32 TrafficCount = 112;
    UPROPERTY(EditAnywhere, Category="Mansoura|World", meta=(ClampMin="0", ClampMax="160")) int32 PedestrianCount = 140;
    UPROPERTY(EditAnywhere, Category="Mansoura|World") bool bShowFootprintDebug = false;
    UPROPERTY(EditAnywhere, Category="Mansoura|World") bool bGenerateStreetActivity = true;

protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
    UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> CityRoot;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UDirectionalLightComponent> Sun;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USkyLightComponent> Sky;
    UPROPERTY(VisibleAnywhere) TObjectPtr<USkyAtmosphereComponent> Atmosphere;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UExponentialHeightFogComponent> Fog;
    UPROPERTY(Transient) TArray<TObjectPtr<UActorComponent>> GeneratedComponents;
    // Serialized CDO references keep these runtime primitives in cooked builds.
    UPROPERTY() TObjectPtr<UStaticMesh> CubeMesh;
    UPROPERTY() TObjectPtr<UStaticMesh> SphereMesh;
    UPROPERTY() TObjectPtr<UStaticMesh> CylinderMesh;

    // Shared pointer permits UHT's generated helper constructors to see only
    // the forward declaration; the implementation owns all native containers.
    TSharedPtr<FMansouraCityData> CityData;
    bool bCityLoaded = false;
    void BuildAmbientTraffic();
    void BuildStreetActivity();
    void UpdateAmbientTraffic(float DeltaSeconds);
    void UpdatePedestrians(float DeltaSeconds);
};
