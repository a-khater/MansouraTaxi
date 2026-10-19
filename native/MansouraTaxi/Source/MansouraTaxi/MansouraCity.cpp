#include "MansouraCity.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "DrawDebugHelpers.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/LexFromString.h"
#include "Misc/Paths.h"
#include "ProceduralMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/ConstructorHelpers.h"

DEFINE_LOG_CATEGORY_STATIC(LogMansouraCity, Log, All);

namespace MansouraCity
{
constexpr double Units = 100.;
constexpr double GroundHeight = 0.;
constexpr double RoadHeight = .14;
constexpr double WaterHeight = -.20;
constexpr double BucketSize = 64.;
using FJson = TSharedPtr<FJsonObject>;

double Number(const FJson& Object, const TCHAR* Field, double Fallback = 0.)
{
    double Result;
    return Object.IsValid() && Object->TryGetNumberField(Field, Result) && FMath::IsFinite(Result) ? Result : Fallback;
}
FString String(const FJson& Object, const TCHAR* Field, const FString& Fallback = FString())
{
    FString Result;
    return Object.IsValid() && Object->TryGetStringField(Field, Result) ? Result : Fallback;
}
bool Boolean(const FJson& Object, const TCHAR* Field, bool Fallback = false)
{
    bool Result;
    return Object.IsValid() && Object->TryGetBoolField(Field, Result) ? Result : Fallback;
}
FJson Object(const FJson& Parent, const TCHAR* Field)
{
    const FJson* Result = nullptr;
    return Parent.IsValid() && Parent->TryGetObjectField(Field, Result) ? *Result : FJson();
}
const TArray<TSharedPtr<FJsonValue>>& Array(const FJson& Parent, const TCHAR* Field)
{
    static const TArray<TSharedPtr<FJsonValue>> Empty;
    const TArray<TSharedPtr<FJsonValue>>* Result = nullptr;
    return Parent.IsValid() && Parent->TryGetArrayField(Field, Result) ? *Result : Empty;
}
FJson ReadJson(const TCHAR* Name)
{
    FString Text;
    const FString Path = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Data"), Name);
    if (!FFileHelper::LoadFileToString(Text, *Path))
    {
        UE_LOG(LogMansouraCity, Warning, TEXT("Cannot load %s"), *Path);
        return nullptr;
    }
    FJson Result;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(Reader, Result) || !Result.IsValid())
    {
        UE_LOG(LogMansouraCity, Error, TEXT("Invalid JSON: %s"), *Path);
        return nullptr;
    }
    return Result;
}
FVector ToWorld(const FVector2D& Point, double Height = RoadHeight)
{
    return FVector(-Point.Y * Units, Point.X * Units, Height * Units);
}
FVector2D ToMap(const FVector& Point) { return FVector2D(Point.Y / Units, -Point.X / Units); }
FVector2D Point(const FJson& Json) { return FVector2D(Number(Json, TEXT("x")), Number(Json, TEXT("z"))); }
TArray<FVector2D> Ring(const TArray<TSharedPtr<FJsonValue>>& Values)
{
    TArray<FVector2D> Result;
    for (const auto& Value : Values)
    {
        if (!Value.IsValid() || Value->Type != EJson::Object) continue;
        const FJson Json = Value->AsObject();
        double X, Z;
        if (Json->TryGetNumberField(TEXT("x"), X) && Json->TryGetNumberField(TEXT("z"), Z) && FMath::IsFinite(X) && FMath::IsFinite(Z))
        {
            const FVector2D P(X, Z);
            if (Result.IsEmpty() || !Result.Last().Equals(P, .0001)) Result.Add(P);
        }
    }
    if (Result.Num() > 2 && Result[0].Equals(Result.Last(), .0001)) Result.Pop();
    return Result;
}
struct FPolygon
{
    TArray<FVector2D> Outer;
    TArray<TArray<FVector2D>> Holes;
    FBox2D Bounds = FBox2D(ForceInit);
    FString Id;
    double Height = 0.;
};
FPolygon Polygon(const FJson& Json)
{
    FPolygon Result;
    Result.Id = String(Json, TEXT("id"));
    Result.Height = Number(Json, TEXT("height"), 15.);
    Result.Outer = Ring(Array(Json, TEXT("points")));
    for (const FVector2D& P : Result.Outer) Result.Bounds += P;
    for (const auto& Hole : Array(Json, TEXT("holes")))
        if (Hole.IsValid() && Hole->Type == EJson::Array) Result.Holes.Add(Ring(Hole->AsArray()));
    return Result;
}
bool InsideRing(const FVector2D& P, const TArray<FVector2D>& Points)
{
    bool bInside = false;
    for (int32 I = 0, J = Points.Num() - 1; I < Points.Num(); J = I++)
    {
        const FVector2D& A = Points[I]; const FVector2D& B = Points[J];
        if ((A.Y > P.Y) != (B.Y > P.Y) && P.X < (B.X - A.X) * (P.Y - A.Y) / (B.Y - A.Y) + A.X) bInside = !bInside;
    }
    return bInside;
}
bool Inside(const FVector2D& P, const FPolygon& Poly)
{
    if (!Poly.Bounds.IsInsideOrOn(P) || !InsideRing(P, Poly.Outer)) return false;
    for (const auto& Hole : Poly.Holes) if (InsideRing(P, Hole)) return false;
    return true;
}
double SegmentDistance(const FVector2D& P, const FVector2D& A, const FVector2D& B)
{
    const FVector2D D = B - A;
    const double T = D.SizeSquared() > .000001 ? FMath::Clamp(FVector2D::DotProduct(P - A, D) / D.SizeSquared(), 0., 1.) : 0.;
    return FVector2D::Distance(P, A + D * T);
}
bool Touches(const FVector2D& P, double Radius, const FPolygon& Poly)
{
    if (!Poly.Bounds.ExpandBy(Radius).IsInsideOrOn(P)) return false;
    if (Inside(P, Poly)) return true;
    const auto NearRing = [&](const TArray<FVector2D>& Points)
    {
        for (int32 I = 0; I < Points.Num(); ++I)
            if (SegmentDistance(P, Points[I], Points[(I + 1) % Points.Num()]) < Radius) return true;
        return false;
    };
    if (NearRing(Poly.Outer)) return true;
    for (const auto& Hole : Poly.Holes) if (NearRing(Hole)) return true;
    return false;
}
struct FMeshBatch
{
    FVector Origin = FVector::ZeroVector;
    TArray<FVector> Vertices;
    TArray<int32> Triangles;
    TArray<FVector> Normals;
    TArray<FVector2D> UV;
    UMaterialInterface* Material = nullptr;
    bool bCollision = false;
    bool bVisible = true;
    void Triangle(const FVector& A, const FVector& B, const FVector& C)
    {
        const FVector Cross = FVector::CrossProduct(B - A, C - A);
        if (Cross.SizeSquared() < .001) return;
        const int32 Base = Vertices.Num();
        Vertices.Add(A - Origin); Vertices.Add(B - Origin); Vertices.Add(C - Origin);
        Triangles.Append({Base, Base + 1, Base + 2});
        const FVector N = Cross.GetSafeNormal();
        for (const FVector& P : {A, B, C}) { Normals.Add(N); UV.Add(FVector2D(P.X, P.Y) / 400.); }
    }
    void Quad(const FVector& A, const FVector& B, const FVector& C, const FVector& D)
    {
        Triangle(A, B, C); Triangle(A, C, D);
    }
};

/** Trapezoid decomposition uses literal ring edges and preserves concavity and
 *  inner courtyards. No convex fan or bounding-box roof crosses a road/river.
 *  Splitting at every source Y coordinate keeps each active edge linear. */
void FillRings(const TArray<TArray<FVector2D>>& Rings, double Height, FMeshBatch& Mesh,
               TFunctionRef<bool(const FVector2D&)> ShouldFill)
{
    TArray<double> Levels;
    struct FEdge { FVector2D A, B; double X(double Y) const { return A.X + (B.X - A.X) * (Y - A.Y) / (B.Y - A.Y); } };
    TArray<FEdge> Edges;
    for (const auto& Points : Rings) for (int32 I = 0; I < Points.Num(); ++I)
    {
        const FVector2D& A = Points[I]; const FVector2D& B = Points[(I + 1) % Points.Num()];
        Levels.Add(A.Y);
        if (FMath::Abs(B.Y - A.Y) > .0000001) Edges.Add({A, B});
    }
    Levels.Sort();
    for (int32 I = Levels.Num() - 1; I > 0; --I) if (FMath::Abs(Levels[I] - Levels[I - 1]) < .0000001) Levels.RemoveAt(I);
    for (int32 I = 0; I + 1 < Levels.Num(); ++I)
    {
        const double Low = Levels[I], High = Levels[I + 1], Mid = (Low + High) * .5;
        TArray<int32> Active;
        for (int32 E = 0; E < Edges.Num(); ++E)
            if (Mid > FMath::Min(Edges[E].A.Y, Edges[E].B.Y) && Mid < FMath::Max(Edges[E].A.Y, Edges[E].B.Y)) Active.Add(E);
        Active.Sort([&](int32 A, int32 B) { return Edges[A].X(Mid) < Edges[B].X(Mid); });
        for (int32 E = 0; E + 1 < Active.Num(); ++E)
        {
            const FEdge& Left = Edges[Active[E]]; const FEdge& Right = Edges[Active[E + 1]];
            if (Right.X(Mid) - Left.X(Mid) < .00001 || !ShouldFill(FVector2D((Left.X(Mid) + Right.X(Mid)) * .5, Mid))) continue;
            // East/south -> north/east conversion is orientation preserving.
            Mesh.Quad(ToWorld({Left.X(Low), Low}, Height), ToWorld({Right.X(Low), Low}, Height),
                      ToWorld({Right.X(High), High}, Height), ToWorld({Left.X(High), High}, Height));
        }
    }
}
FString NodeKey(const FJson& Json)
{
    const TSharedPtr<FJsonValue> Id = Json->TryGetField(TEXT("nodeId"));
    if (Id.IsValid() && Id->Type == EJson::String) return Id->AsString();
    if (Id.IsValid() && Id->Type == EJson::Number) return FString::Printf(TEXT("%.0f"), Id->AsNumber());
    const FVector2D P = Point(Json);
    return FString::Printf(TEXT("coordinate:%.3f:%.3f"), P.X, P.Y);
}
int32 OneWay(const FJson& Json)
{
    const TSharedPtr<FJsonValue> Value = Json->TryGetField(TEXT("oneway"));
    if (!Value.IsValid()) return 0;
    if (Value->Type == EJson::Number) return FMath::Clamp(static_cast<int32>(Value->AsNumber()), -1, 1);
    if (Value->Type == EJson::Boolean) return Value->AsBool() ? 1 : 0;
    if (Value->Type == EJson::String)
    {
        const FString Text = Value->AsString();
        if (Text == TEXT("-1")) return -1;
        if (Text == TEXT("yes") || Text == TEXT("1") || Text == TEXT("true")) return 1;
    }
    return 0;
}
struct FTrafficEdge
{
    FVector2D A, B;
    int32 From = INDEX_NONE, To = INDEX_NONE;
    double Length = 0., Width = 6., Speed = 8.;
    FString SourceId;
};
struct FInstancePart
{
    UInstancedStaticMeshComponent* Mesh = nullptr;
    int32 Index = INDEX_NONE;
    FVector Offset = FVector::ZeroVector; // metres in forward/right/up coordinates
    FVector Size = FVector::OneVector;   // Engine basic meshes have 100cm extent
    double Gait = 0.;
};
struct FTrafficVehicle
{
    int32 Edge = INDEX_NONE;
    double Distance = 0., Speed = 0., Cruise = 8., Length = 4.2;
    FVector Position = FVector::ZeroVector;
    double Yaw = 0.;
    TArray<FInstancePart> Parts;
};
struct FWalker
{
    FVector2D A, B;
    double Alpha = 0., Direction = 1., Speed = 1.1, Phase = 0.;
    TArray<FInstancePart> Parts;
};
FTransform PartTransform(const FInstancePart& Part, const FVector& Position, double Yaw, double Gait = 0.)
{
    const FRotator Heading(0., Yaw, 0.);
    const FVector Offset = Heading.RotateVector(Part.Offset * Units);
    const FRotator Swing(FMath::Sin(Gait) * Part.Gait * 22., 0., 0.);
    return FTransform(Heading.Quaternion() * Swing.Quaternion(), Position + Offset, Part.Size);
}
}

struct FMansouraCityData
{
    using FPolygon = MansouraCity::FPolygon;
    TSharedPtr<FJsonObject> Map;
    TArray<FPolygon> Buildings, Water, WaterCollision;
    TMap<FIntPoint, TArray<int32>> BuildingBuckets;
    TSet<FString> CustomCollisionBuildingIds;
    TArray<FPolygon> ReferenceCollision;
    struct FRoadSpan { FVector2D A, B; double Width; };
    TArray<FRoadSpan> RoadSpans;
    TMap<FIntPoint, TArray<int32>> RoadBuckets;
    FBox2D Bounds = FBox2D(ForceInit);
    FTransform Start = FTransform::Identity;
    TArray<MansouraCity::FTrafficEdge> Edges;
    TArray<TArray<int32>> Outgoing;
    TArray<MansouraCity::FTrafficVehicle> Vehicles;
    TArray<MansouraCity::FWalker> Walkers;
    TArray<UInstancedStaticMeshComponent*> MovingMeshes;
    TMap<FString, UMaterialInterface*> Materials;
    FRandomStream Random{4815};

    bool BuildingBlocked(const FVector2D& Point, double Radius) const
    {
        const int32 MinX = FMath::FloorToInt((Point.X - Radius) / MansouraCity::BucketSize);
        const int32 MaxX = FMath::FloorToInt((Point.X + Radius) / MansouraCity::BucketSize);
        const int32 MinY = FMath::FloorToInt((Point.Y - Radius) / MansouraCity::BucketSize);
        const int32 MaxY = FMath::FloorToInt((Point.Y + Radius) / MansouraCity::BucketSize);
        for (int32 X = MinX; X <= MaxX; ++X) for (int32 Y = MinY; Y <= MaxY; ++Y)
            if (const TArray<int32>* Candidates = BuildingBuckets.Find(FIntPoint(X, Y)))
                for (int32 Index : *Candidates)
                    if (!CustomCollisionBuildingIds.Contains(Buildings[Index].Id) && MansouraCity::Touches(Point, Radius, Buildings[Index])) return true;
        for (const auto& Poly : ReferenceCollision) if (MansouraCity::Touches(Point, Radius, Poly)) return true;
        return false;
    }
    bool RoadClear(const FVector2D& Point, double Margin) const
    {
        if (const TArray<int32>* Candidates = RoadBuckets.Find(FIntPoint(FMath::FloorToInt(Point.X / MansouraCity::BucketSize), FMath::FloorToInt(Point.Y / MansouraCity::BucketSize))))
            for (int32 Index : *Candidates)
            {
                const auto& Span = RoadSpans[Index];
                if (MansouraCity::SegmentDistance(Point, Span.A, Span.B) < Span.Width * .5 + Margin) return false;
            }
        return true;
    }
    bool WaterBlocked(const FVector2D& Point, double Radius = 0.) const
    {
        for (const FPolygon& Poly : WaterCollision) if (MansouraCity::Touches(Point, Radius, Poly)) return true;
        return false;
    }
    bool InWater(const FVector2D& Point) const
    {
        for (const FPolygon& Poly : Water) if (MansouraCity::Inside(Point, Poly)) return true;
        return false;
    }
};

AMansouraCity::AMansouraCity()
{
    PrimaryActorTick.bCanEverTick = true;
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeAsset(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereAsset(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderAsset(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    CubeMesh=CubeAsset.Object;SphereMesh=SphereAsset.Object;CylinderMesh=CylinderAsset.Object;
    CityRoot = CreateDefaultSubobject<USceneComponent>(TEXT("CityRoot")); CityRoot->SetMobility(EComponentMobility::Static); SetRootComponent(CityRoot);
    Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("GoldenHourSun")); Sun->SetupAttachment(CityRoot);
    Sun->SetMobility(EComponentMobility::Movable); Sun->SetRelativeRotation(FRotator(-24., -128., 0.));
    Sun->Intensity = 5.f; Sun->LightColor = FColor(255, 225, 184); Sun->bAtmosphereSunLight = true;
    Sky = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight")); Sky->SetupAttachment(CityRoot);
    Sky->SetMobility(EComponentMobility::Movable); Sky->bRealTimeCapture = true; Sky->Intensity = .85f;
    Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("SkyAtmosphere")); Atmosphere->SetupAttachment(CityRoot);
    Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("NileHaze")); Fog->SetupAttachment(CityRoot);
    Fog->SetFogDensity(.0015f); Fog->SetFogHeightFalloff(.2f); Fog->SetFogInscatteringColor(FLinearColor(.66f, .72f, .76f));
    AccuracyNotice = TEXT("OpenStreetMap road and footprint geometry. Building heights and massing proxies are unverified. Imported reference models are photo-based estimates, not surveyed replicas. Street activity is original simulation; traffic follows source nodes and one-way tags, with unsupplied turn restrictions unmodeled.");
    MapAttribution = TEXT("Map data: OpenStreetMap contributors, ODbL 1.0 | openstreetmap.org/copyright");
}
AMansouraCity::~AMansouraCity() = default;
void AMansouraCity::BeginPlay()
{
    Super::BeginPlay();
    if (bAutoLoad && !bCityLoaded) LoadCity();
}
void AMansouraCity::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    CityData.Reset();
    Super::EndPlay(EndPlayReason);
}

bool AMansouraCity::LoadCity()
{
    using namespace MansouraCity;
    if (bCityLoaded) return true;
    const FJson Map = ReadJson(TEXT("mansoura-map.json"));
    if (!Map.IsValid() || Array(Object(Map, TEXT("roads")), TEXT("segments")).IsEmpty()) return false;
    bCityLoaded = false;
    for (UActorComponent* Component : GeneratedComponents) if (IsValid(Component)) Component->DestroyComponent();
    GeneratedComponents.Empty(); Destinations.Empty();
    CityData = MakeShared<FMansouraCityData>(); CityData->Map = Map;
    MappedBuildingCount = 0; ImportedReferenceCount = 0; ConnectedTrafficEdgeCount = 0;
    CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
    SphereMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    CylinderMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    if (!CubeMesh || !SphereMesh || !CylinderMesh) return false;

    UMaterialInterface* Prototype = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Mansoura/Materials/M_Prototype.M_Prototype"));
    if (!Prototype) Prototype = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    const auto Material = [&](const FString& Name, FLinearColor Color, float Roughness = .85f, FLinearColor Emissive = FLinearColor::Black) -> UMaterialInterface*
    {
        UMaterialInstanceDynamic* Instance = UMaterialInstanceDynamic::Create(Prototype, this);
        if (Instance)
        {
            Instance->SetVectorParameterValue(TEXT("Color"), Color);
            Instance->SetScalarParameterValue(TEXT("Roughness"), Roughness);
            Instance->SetVectorParameterValue(TEXT("Emissive"), Emissive);
        }
        CityData->Materials.Add(Name, Instance ? static_cast<UMaterialInterface*>(Instance) : Prototype);
        return Instance ? static_cast<UMaterialInterface*>(Instance) : Prototype;
    };
    UMaterialInterface* Ground = Material(TEXT("Ground"), FLinearColor(.37f, .34f, .28f));
    UMaterialInterface* Asphalt = Material(TEXT("Road"), FLinearColor(.075f, .082f, .085f));
    UMaterialInterface* PathMaterial = Material(TEXT("Path"), FLinearColor(.42f, .39f, .33f));
    UMaterialInterface* WaterMaterial = Material(TEXT("Water"), FLinearColor(.035f, .16f, .18f), .2f);
    Material(TEXT("TrafficMaroon"), FLinearColor(.28f, .027f, .045f), .28f);
    Material(TEXT("Cream"), FLinearColor(.79f, .73f, .57f), .6f);
    Material(TEXT("Glass"), FLinearColor(.035f, .08f, .10f), .18f);
    Material(TEXT("Rubber"), FLinearColor(.012f, .015f, .016f));
    Material(TEXT("Microbus"), FLinearColor(.73f, .76f, .72f), .35f);
    Material(TEXT("Blue"), FLinearColor(.04f, .19f, .32f), .5f);
    Material(TEXT("Leaf"), FLinearColor(.11f, .23f, .065f));
    Material(TEXT("Trunk"), FLinearColor(.26f, .18f, .095f));
    Material(TEXT("Wood"), FLinearColor(.29f, .15f, .07f));
    Material(TEXT("Scarf"), FLinearColor(.56f, .08f, .18f));
    Material(TEXT("Headlight"), FLinearColor(.92f, .85f, .62f), .3f, FLinearColor(.5f, .36f, .13f));
    UMaterialInterface* MassMaterials[] = {
        Material(TEXT("UnverifiedMassing0"), FLinearColor(.57f,.48f,.36f)),
        Material(TEXT("UnverifiedMassing1"), FLinearColor(.64f,.57f,.45f)),
        Material(TEXT("UnverifiedMassing2"), FLinearColor(.45f,.34f,.26f)),
        Material(TEXT("UnverifiedMassing3"), FLinearColor(.62f,.59f,.51f))
    };

    const FJson Bounds = Object(Map, TEXT("bounds"));
    CityData->Bounds = FBox2D(FVector2D(Number(Bounds, TEXT("minX")), Number(Bounds, TEXT("minZ"))),
                             FVector2D(Number(Bounds, TEXT("maxX")), Number(Bounds, TEXT("maxZ"))));
    const FJson Start = Object(Map, TEXT("start"));
    CityData->Start = FTransform(FRotator(0., -FMath::RadiansToDegrees(Number(Start, TEXT("heading"))), 0.), ToWorld(Point(Start), 1.4));
    for (const auto& Value : Array(Map, TEXT("water"))) if (Value->Type == EJson::Object) CityData->Water.Add(Polygon(Value->AsObject()));
    for (const auto& Value : Array(Map, TEXT("waterColliders"))) if (Value->Type == EJson::Object) CityData->WaterCollision.Add(Polygon(Value->AsObject()));
    if (CityData->WaterCollision.IsEmpty()) CityData->WaterCollision = CityData->Water;
    for (const auto& Value : Array(Map, TEXT("buildings")))
    {
        if (Value->Type != EJson::Object) continue;
        FPolygon Poly = Polygon(Value->AsObject()); if (Poly.Outer.Num() < 3) continue;
        const int32 Index = CityData->Buildings.Add(MoveTemp(Poly));
        const FBox2D& B = CityData->Buildings[Index].Bounds;
        for (int32 X = FMath::FloorToInt(B.Min.X / BucketSize); X <= FMath::FloorToInt(B.Max.X / BucketSize); ++X)
            for (int32 Y = FMath::FloorToInt(B.Min.Y / BucketSize); Y <= FMath::FloorToInt(B.Max.Y / BucketSize); ++Y)
                CityData->BuildingBuckets.FindOrAdd(FIntPoint(X, Y)).Add(Index);
    }
    MappedBuildingCount = CityData->Buildings.Num();

    TMap<FString, FMeshBatch> Batches;
    const auto Batch = [&](const FString& Category, const FVector2D& Center, UMaterialInterface* Mat, bool bCollision = true, bool bVisible = true) -> FMeshBatch&
    {
        const int32 X = FMath::FloorToInt(Center.X / 200.), Y = FMath::FloorToInt(Center.Y / 200.);
        const FString Key = FString::Printf(TEXT("%s_%d_%d"), *Category, X, Y);
        FMeshBatch& Result = Batches.FindOrAdd(Key);
        Result.Origin = ToWorld(FVector2D(X * 200., Y * 200.), 0.);
        Result.Material = Mat; Result.bCollision = bCollision; Result.bVisible = bVisible;
        return Result;
    };
    // Cut the actual mapped river out of terrain. Water island holes become
    // land again through the same predicate; nothing overlays a beige floor.
    const FVector2D Min = CityData->Bounds.Min, Max = CityData->Bounds.Max;
    TArray<TArray<FVector2D>> GroundRings{{Min, FVector2D(Max.X, Min.Y), Max, FVector2D(Min.X, Max.Y)}};
    for (const FPolygon& Water : CityData->Water) { GroundRings.Add(Water.Outer); GroundRings.Append(Water.Holes); }
    FillRings(GroundRings, GroundHeight, Batch(TEXT("TerrainWithRiverCutout"), (Min + Max) * .5, Ground),
        [&](const FVector2D& P) { return CityData->Bounds.IsInsideOrOn(P) && !CityData->InWater(P); });
    for (const FPolygon& Water : CityData->Water)
    {
        TArray<TArray<FVector2D>> Rings{Water.Outer}; Rings.Append(Water.Holes);
        FillRings(Rings, WaterHeight, Batch(TEXT("MappedNile"), Water.Bounds.GetCenter(), WaterMaterial, false),
            [&](const FVector2D& P) { return Inside(P, Water); });
    }
    // Invisible vertical shore barriers follow bridge-cutout collision rings.
    // The river remains open visually; no giant AABB blocks the bridge decks.
    for (const FPolygon& Water : CityData->WaterCollision)
    {
        TArray<TArray<FVector2D>> Rings{Water.Outer}; Rings.Append(Water.Holes);
        for (const auto& Points : Rings) for (int32 I = 0; I < Points.Num(); ++I)
        {
            const FVector2D A = Points[I], B = Points[(I + 1) % Points.Num()];
            FMeshBatch& M = Batch(TEXT("InvisibleWaterBoundary"), (A + B) * .5, Ground, true, false);
            M.Quad(ToWorld(A,-3.),ToWorld(B,-3.),ToWorld(B,1.2),ToWorld(A,1.2));
            M.Quad(ToWorld(B,-3.),ToWorld(A,-3.),ToWorld(A,1.2),ToWorld(B,1.2));
        }
    }

    const auto Instances = [&](const FString& Name, UStaticMesh* Mesh, UMaterialInterface* Mat, bool bCollision, bool bMoving = false)
    {
        auto* Component = NewObject<UHierarchicalInstancedStaticMeshComponent>(this, FName(*Name));
        Component->SetupAttachment(CityRoot); Component->SetMobility(bMoving ? EComponentMobility::Movable : EComponentMobility::Static);
        Component->SetStaticMesh(Mesh); Component->SetMaterial(0, Mat);
        Component->SetCollisionEnabled(bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
        Component->SetCollisionObjectType(bMoving ? ECC_Vehicle : ECC_WorldStatic);
        Component->SetCollisionResponseToAllChannels(ECR_Block); Component->SetGenerateOverlapEvents(false);
        Component->SetCanEverAffectNavigation(false); Component->RegisterComponent(); GeneratedComponents.Add(Component);
        return Component;
    };
    auto* RoadMesh = Instances(TEXT("LiteralMappedRoadSegments"), CubeMesh, Asphalt, true);
    auto* PathMesh = Instances(TEXT("LiteralMappedWalkingPaths"), CubeMesh, PathMaterial, false);
    auto* Markings = Instances(TEXT("InterpretiveRoadDashes"), CubeMesh, CityData->Materials[TEXT("Cream")], false);
    TMap<FString, int32> Nodes;
    const auto Node = [&](const FString& Id) { if (const int32* Found = Nodes.Find(Id)) return *Found; const int32 Index = CityData->Outgoing.AddDefaulted(); Nodes.Add(Id, Index); return Index; };
    const auto DrawRoad = [&](const FJson& Json, UHierarchicalInstancedStaticMeshComponent* Mesh, bool bTraffic)
    {
        const auto& Points = Array(Json, TEXT("points"));
        const double Width = FMath::Clamp(Number(Json, TEXT("width"), bTraffic ? 7. : 2.4), 1., 50.);
        const FJson Tags = Object(Json, TEXT("tags"));
        const FString Access = String(Tags, TEXT("access")), Motor = String(Tags, TEXT("motor_vehicle"));
        const bool bPermitted = Access != TEXT("no") && Access != TEXT("private") && Motor != TEXT("no") && Motor != TEXT("private");
        for (int32 I = 0; I + 1 < Points.Num(); ++I)
        {
            if (Points[I]->Type != EJson::Object || Points[I + 1]->Type != EJson::Object) continue;
            const FJson JA = Points[I]->AsObject(), JB = Points[I + 1]->AsObject();
            const FVector2D A = Point(JA), B = Point(JB); const double Length = FVector2D::Distance(A, B); if (Length < .15) continue;
            if (bTraffic)
            {
                const int32 Index=CityData->RoadSpans.Add({A,B,Width});
                const double Extent=Width*.5+6.;
                for(int32 X=FMath::FloorToInt((FMath::Min(A.X,B.X)-Extent)/BucketSize);X<=FMath::FloorToInt((FMath::Max(A.X,B.X)+Extent)/BucketSize);++X)
                    for(int32 Y=FMath::FloorToInt((FMath::Min(A.Y,B.Y)-Extent)/BucketSize);Y<=FMath::FloorToInt((FMath::Max(A.Y,B.Y)+Extent)/BucketSize);++Y)
                        CityData->RoadBuckets.FindOrAdd(FIntPoint(X,Y)).Add(Index);
            }
            const FVector Direction = (ToWorld(B) - ToWorld(A)).GetSafeNormal();
            const double Yaw = Direction.Rotation().Yaw;
            Mesh->AddInstance(FTransform(FRotator(0.,Yaw,0.), ToWorld((A+B)*.5,bTraffic ? RoadHeight-.06 : .02), FVector(Length+.03, Width, bTraffic ? .12 : .04)));
            if (bTraffic && Width >= 8. && Length > 7.)
                for (double T = 3.; T < Length - 2.; T += 11.)
                    Markings->AddInstance(FTransform(FRotator(0.,Yaw,0.), ToWorld(A+(B-A)*(T/Length),RoadHeight+.008), FVector(3.,.10,.012)));
            if (!bTraffic || !bPermitted || Width < 5.3) continue;
            const int32 NA = Node(NodeKey(JA)), NB = Node(NodeKey(JB));
            const int32 Legal = OneWay(Json);
            const auto AddEdge = [&](const FVector2D& From, const FVector2D& To, int32 FromNode, int32 ToNode)
            {
                const FVector2D D = (To-From).GetSafeNormal();
                // Right-hand lane offset expressed back in east/south axes.
                const FVector2D Offset(-D.Y,D.X);
                const double Lane = FMath::Clamp(Width*.24,.45,2.8);
                for (double T : {.08,.28,.5,.72,.92})
                {
                    const FVector2D P = From+(To-From)*T+Offset*Lane;
                    if (!CityData->Bounds.IsInsideOrOn(P) || CityData->BuildingBlocked(P,1.05) || CityData->WaterBlocked(P,.65)) return;
                }
                FTrafficEdge Edge; Edge.A=From;Edge.B=To;Edge.From=FromNode;Edge.To=ToNode;Edge.Length=Length;Edge.Width=Width;
                const FString Highway=String(Json,TEXT("highway")); Edge.Speed=(Highway==TEXT("primary")||Highway==TEXT("secondary"))?10.:6.5;
                double Limit=0.; const FString LimitText=String(Tags,TEXT("maxspeed"));
                if (LexTryParseString(Limit,*LimitText) && Limit>0.) Edge.Speed=FMath::Min(Edge.Speed,Limit/3.6);
                Edge.SourceId=String(Json,TEXT("id")); const int32 Index=CityData->Edges.Add(MoveTemp(Edge)); CityData->Outgoing[FromNode].Add(Index);
            };
            if (Legal>=0) AddEdge(A,B,NA,NB);
            if (Legal<=0) AddEdge(B,A,NB,NA);
        }
    };
    for (const auto& Value : Array(Object(Map,TEXT("roads")),TEXT("segments"))) if (Value->Type==EJson::Object) DrawRoad(Value->AsObject(),RoadMesh,true);
    for (const auto& Value : Array(Map,TEXT("paths"))) if (Value->Type==EJson::Object) DrawRoad(Value->AsObject(),PathMesh,false);
    ConnectedTrafficEdgeCount=CityData->Edges.Num();

    TMap<FString,FJson> ReferenceAssets;
    for (const auto& Value : Array(ReadJson(TEXT("reference-assets.json")),TEXT("entries")))
        if (Value->Type==EJson::Object) { const FJson Entry=Value->AsObject();ReferenceAssets.Add(String(Entry,TEXT("buildingId")),Entry); }
    for (int32 BI=0;BI<CityData->Buildings.Num();++BI)
    {
        const FPolygon& Poly=CityData->Buildings[BI];
        if (const FJson* Entry=ReferenceAssets.Find(Poly.Id))
        {
            const FString Path=String(*Entry,TEXT("meshPath"),String(*Entry,TEXT("mesh")));
            UStaticMesh* Mesh=Path.IsEmpty()?nullptr:LoadObject<UStaticMesh>(nullptr,*Path);
            const FString GeometryOrigin=String(*Entry,TEXT("geometryOrigin"),TEXT("building-local"));
            if (Mesh && (GeometryOrigin==TEXT("building-local") || GeometryOrigin==TEXT("world-relative")))
            {
                auto* Component=NewObject<UStaticMeshComponent>(this);Component->SetupAttachment(CityRoot);Component->SetMobility(EComponentMobility::Static);Component->SetStaticMesh(Mesh);
                if (GeometryOrigin==TEXT("building-local")) Component->SetRelativeTransform(FTransform(FRotator(0.,Number(*Entry,TEXT("yawDegrees")),0.),ToWorld(Point(*Entry),0.)));
                Component->ComponentTags.Add(FName(*Poly.Id));Component->ComponentTags.Add(TEXT("PhotoReferenced_DimensionsEstimated"));
                Component->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);Component->SetCollisionResponseToAllChannels(ECR_Block);Component->RegisterComponent();GeneratedComponents.Add(Component);++ImportedReferenceCount;
                // Compound reference colliders use source east/south metres.
                // A loaded open gate must not retain its solid canopy proxy.
                const auto& Compound=Array(*Entry,TEXT("colliders"));
                if(!Compound.IsEmpty())
                {
                    int32 Added=0;
                    for(const auto& Value:Compound)if(Value->Type==EJson::Object)
                    {
                        const FJson Collider=Value->AsObject();FPolygon Shape=Polygon(Collider);
                        if(Shape.Outer.Num()<3)Shape.Outer=Ring(Array(Collider,TEXT("polygon")));
                        Shape.Bounds=FBox2D(ForceInit);for(const auto& P:Shape.Outer)Shape.Bounds+=P;
                        if(Shape.Outer.Num()>=3){CityData->ReferenceCollision.Add(MoveTemp(Shape));++Added;}
                    }
                    if(Added>0)CityData->CustomCollisionBuildingIds.Add(Poly.Id);
                }
                continue;
            }
            UE_LOG(LogMansouraCity,Warning,TEXT("Reference mesh unavailable for %s; retaining explicit unverified mapped massing"),*Poly.Id);
        }
        const double Height=FMath::Clamp(Poly.Height,2.,100.);
        FMeshBatch& Mass=Batch(FString::Printf(TEXT("UNVERIFIED_FootprintMassing_%d"),BI%4),Poly.Bounds.GetCenter(),MassMaterials[BI%4]);
        TArray<TArray<FVector2D>> Rings{Poly.Outer};Rings.Append(Poly.Holes);
        FillRings(Rings,Height,Mass,[&](const FVector2D& P){return Inside(P,Poly);});
        for (const auto& Points : Rings) for (int32 I=0;I<Points.Num();++I)
        {
            const FVector2D A=Points[I],B=Points[(I+1)%Points.Num()];
            Mass.Quad(ToWorld(A,0.),ToWorld(B,0.),ToWorld(B,Height),ToWorld(A,Height));
            Mass.Quad(ToWorld(B,0.),ToWorld(A,0.),ToWorld(A,Height),ToWorld(B,Height));
        }
    }
    for (auto& Pair : Batches)
    {
        FMeshBatch& Data=Pair.Value;if(Data.Vertices.IsEmpty())continue;
        auto* Component=NewObject<UProceduralMeshComponent>(this,FName(*Pair.Key));Component->SetupAttachment(CityRoot);Component->SetMobility(EComponentMobility::Static);
        Component->SetRelativeLocation(Data.Origin);Component->bUseAsyncCooking=true;Component->bUseComplexAsSimpleCollision=true;
        Component->CreateMeshSection_LinearColor(0,Data.Vertices,Data.Triangles,Data.Normals,Data.UV,TArray<FLinearColor>(),TArray<FProcMeshTangent>(),Data.bCollision,false);
        Component->SetMaterial(0,Data.Material);Component->SetCollisionEnabled(Data.bCollision?ECollisionEnabled::QueryAndPhysics:ECollisionEnabled::NoCollision);
        Component->SetCollisionResponseToAllChannels(ECR_Block);Component->SetVisibility(Data.bVisible);Component->SetHiddenInGame(!Data.bVisible);
        Component->ComponentTags.Add(FName(*Pair.Key));Component->RegisterComponent();GeneratedComponents.Add(Component);
    }

    for (const auto& Value : Array(ReadJson(TEXT("destinations.json")),TEXT("entries")))
    {
        if(Value->Type!=EJson::Object)continue;const FJson Entry=Value->AsObject();const FJson Access=Object(Entry,TEXT("roadAccess"));
        FMansouraCityDestination Destination;Destination.Id=String(Entry,TEXT("id"));Destination.Name=String(Entry,TEXT("name"));Destination.Arabic=String(Entry,TEXT("arabic"));
        Destination.Kind=String(Entry,TEXT("kind"));Destination.LocationStatus=String(Entry,TEXT("locationStatus"));Destination.Location=ToWorld(Point(Entry));
        Destination.RoadAccess=FTransform(FRotator(0.,-FMath::RadiansToDegrees(Number(Access,TEXT("heading"))),0.),ToWorld(Point(Access),1.4));
        Destination.bReachable=Access.IsValid()&&Boolean(Access,TEXT("reachable"))&&IsLocationClear(Destination.RoadAccess.GetLocation(),90.f);
        if(!Destination.Id.IsEmpty())Destinations.Add(MoveTemp(Destination));
    }
    bCityLoaded=true;
    BuildAmbientTraffic();if(bGenerateStreetActivity)BuildStreetActivity();
    UE_LOG(LogMansouraCity,Display,TEXT("Loaded %d mapped footprints (%d imported references), %d legal directed traffic edges, %d destinations. %s"),MappedBuildingCount,ImportedReferenceCount,ConnectedTrafficEdgeCount,Destinations.Num(),*AccuracyNotice);
    return true;
}

FTransform AMansouraCity::GetTaxiStart() const { return CityData?CityData->Start:FTransform(FVector(0.,0.,140.)); }
FBox AMansouraCity::GetCityBounds() const
{
    if(!CityData)return FBox(ForceInit);
    const FVector A=MansouraCity::ToWorld(CityData->Bounds.Min,-10.),B=MansouraCity::ToWorld(CityData->Bounds.Max,150.);
    return FBox(A.ComponentMin(B),A.ComponentMax(B));
}
bool AMansouraCity::GetDestinationAccess(const FString& Id,FTransform& Access) const
{
    for(const auto& Destination:Destinations)if(Destination.Id==Id&&Destination.bReachable){Access=Destination.RoadAccess;return true;}return false;
}
bool AMansouraCity::IsLocationClear(FVector Location,float RadiusCm) const
{
    if(!CityData)return false;
    const FVector2D P=MansouraCity::ToMap(Location);const double Radius=FMath::Max(0.f,RadiusCm)/100.;
    return CityData->Bounds.Min.X+Radius<=P.X&&P.X<=CityData->Bounds.Max.X-Radius&&CityData->Bounds.Min.Y+Radius<=P.Y&&P.Y<=CityData->Bounds.Max.Y-Radius
        &&!CityData->BuildingBlocked(P,Radius)&&!CityData->WaterBlocked(P,Radius);
}
bool AMansouraCity::FindNearestRoadPose(FVector Location,FTransform& Pose,float SearchRadiusCm) const
{
    using namespace MansouraCity;if(!CityData)return false;const FVector2D P=ToMap(Location);double Best=FMath::Max(0.f,SearchRadiusCm)/100.;bool bFound=false;
    for(const auto& Edge:CityData->Edges)
    {
        const FVector2D D=Edge.B-Edge.A;const double Along=FMath::Clamp(FVector2D::DotProduct(P-Edge.A,D)/D.SizeSquared(),0.,1.)*Edge.Length;
        for(double Offset:{0.,-5.,5.,-10.,10.,-20.,20.})
        {
            const FVector2D Center=Edge.A+D*(FMath::Clamp(Along+Offset,0.,Edge.Length)/Edge.Length);const double Distance=FVector2D::Distance(P,Center);if(Distance>=Best)continue;
            bool bClear=true;for(double T:{-1.2,0.,1.2})if(!IsLocationClear(ToWorld(Center+D.GetSafeNormal()*T),90.f)){bClear=false;break;}
            if(!bClear)continue;const FVector WorldDirection=ToWorld(Edge.B)-ToWorld(Edge.A);Pose=FTransform(WorldDirection.Rotation(),ToWorld(Center,1.4));Best=Distance;bFound=true;
        }
    }return bFound;
}
void AMansouraCity::SetNight(bool bNight)
{
    Sun->SetIntensity(bNight?.12f:5.f);Sun->SetLightColor(bNight?FLinearColor(.4f,.5f,.72f):FLinearColor(1.f,.86f,.68f));
    Sun->SetRelativeRotation(bNight?FRotator(-20.,65.,0.):FRotator(-24.,-128.,0.));Sky->SetIntensity(bNight?.18f:.85f);
    Fog->SetFogInscatteringColor(bNight?FLinearColor(.035f,.055f,.1f):FLinearColor(.66f,.72f,.76f));
}

void AMansouraCity::BuildAmbientTraffic()
{
    using namespace MansouraCity;if(!CityData||CityData->Edges.IsEmpty())return;
    const auto Make=[&](const TCHAR* Name,const TCHAR* Mat,bool bCollision=false)
    {
        auto* Mesh=NewObject<UInstancedStaticMeshComponent>(this,FName(Name));Mesh->SetupAttachment(CityRoot);Mesh->SetMobility(EComponentMobility::Movable);Mesh->SetStaticMesh(CubeMesh);Mesh->SetMaterial(0,CityData->Materials[Mat]);
        Mesh->SetCollisionEnabled(bCollision?ECollisionEnabled::QueryAndPhysics:ECollisionEnabled::NoCollision);Mesh->SetCollisionObjectType(ECC_Vehicle);Mesh->SetCollisionResponseToAllChannels(ECR_Block);Mesh->SetGenerateOverlapEvents(false);Mesh->SetCanEverAffectNavigation(false);
        Mesh->RegisterComponent();GeneratedComponents.Add(Mesh);CityData->MovingMeshes.Add(Mesh);return Mesh;
    };
    auto* CarBody=Make(TEXT("AmbientSedans"),TEXT("TrafficMaroon"),true);auto* CarRoof=Make(TEXT("CreamTaxiRoofs"),TEXT("Cream"));
    auto* BusBody=Make(TEXT("AmbientMicrobuses"),TEXT("Microbus"),true);auto* Glass=Make(TEXT("TrafficGlazing"),TEXT("Glass"));
    auto* Wheels=Make(TEXT("TrafficWheels"),TEXT("Rubber"));auto* Stripe=Make(TEXT("MicrobusBlueStripe"),TEXT("Blue"));auto* Lamps=Make(TEXT("TrafficLamps"),TEXT("Headlight"));
    TArray<int32> CandidateEdges;const FVector2D Start=ToMap(CityData->Start.GetLocation());
    for(int32 I=0;I<CityData->Edges.Num();++I){const auto& Edge=CityData->Edges[I];if(Edge.Length>13.&&FVector2D::Distance((Edge.A+Edge.B)*.5,Start)<1200.)CandidateEdges.Add(I);}
    if(CandidateEdges.IsEmpty())return;
    for(int32 I=0;I<FMath::Clamp(TrafficCount,0,140);++I)
    {
        FTrafficVehicle Vehicle;Vehicle.Edge=CandidateEdges[CityData->Random.RandRange(0,CandidateEdges.Num()-1)];const auto& Edge=CityData->Edges[Vehicle.Edge];
        Vehicle.Distance=CityData->Random.FRandRange(1.,FMath::Max(1.,Edge.Length-3.));Vehicle.Cruise=CityData->Random.FRandRange(.75,.98)*Edge.Speed;
        const FVector2D Spawn=FMath::Lerp(Edge.A,Edge.B,Vehicle.Distance/Edge.Length);
        if(FVector2D::Distance(Spawn,Start)<30.)continue; // Keep the initial taxi/camera unobstructed.
        bool bOccupied=false;for(const auto& Existing:CityData->Vehicles)if(Existing.Edge==Vehicle.Edge&&FMath::Abs(Existing.Distance-Vehicle.Distance)<12.){bOccupied=true;break;}if(bOccupied)continue;
        const bool bBus=I%6==0;Vehicle.Length=bBus?5.5:4.25;
        const auto Part=[&](auto* Mesh,FVector Offset,FVector Size){FInstancePart P;P.Mesh=Mesh;P.Offset=Offset;P.Size=Size;P.Index=Mesh->AddInstance(FTransform(FVector(0.,0.,-20000.)));Vehicle.Parts.Add(P);};
        Part(bBus?BusBody:CarBody,{0.,0.,bBus?1.05:.66},{Vehicle.Length,bBus?2.12:1.76,bBus?1.5:.67});
        Part(bBus?BusBody:CarRoof,{bBus?-.2:-.25,0.,bBus?1.87:1.22},{bBus?4.4:2.3,bBus?2.1:1.58,bBus?.28:.48});
        Part(Glass,{bBus?.05:-.15,0.,bBus?1.58:1.26},{bBus?4.2:2.35,bBus?2.135:1.6,bBus?.72:.33});
        if(bBus)Part(Stripe,{0.,0.,.85},{5.55,2.14,.19});
        for(double X:{-1.4,1.35})for(double Y:{-.91,.91})Part(Wheels,{X*(bBus?1.22:1.),Y*(bBus?1.16:1.),.36},{.66,.22,.66});
        for(double Y:{-.59,.59})Part(Lamps,{Vehicle.Length*.505,Y,.7},{.055,.37,.19});
        CityData->Vehicles.Add(MoveTemp(Vehicle));
    }
    UpdateAmbientTraffic(0.);
}

void AMansouraCity::UpdateAmbientTraffic(float DeltaSeconds)
{
    using namespace MansouraCity;if(!CityData)return;const double DT=FMath::Clamp(static_cast<double>(DeltaSeconds),0.,.05);
    const APawn* Player=UGameplayStatics::GetPlayerPawn(this,0);const FVector PlayerPosition=Player?Player->GetActorLocation():CityData->Start.GetLocation();
    TArray<double> Distances;Distances.Reserve(CityData->Vehicles.Num());for(const auto& V:CityData->Vehicles)Distances.Add(V.Distance);
    for(int32 I=0;I<CityData->Vehicles.Num();++I)
    {
        auto& Vehicle=CityData->Vehicles[I];if(!CityData->Edges.IsValidIndex(Vehicle.Edge))continue;
        const int32 PreviousEdge=Vehicle.Edge;const double PreviousDistance=Vehicle.Distance;
        const FTrafficEdge* Edge=&CityData->Edges[Vehicle.Edge];double Target=FMath::Min(Vehicle.Cruise,Edge->Speed);
        for(int32 J=0;J<CityData->Vehicles.Num();++J)if(I!=J&&CityData->Vehicles[J].Edge==Vehicle.Edge)
        {
            const double Gap=Distances[J]-Distances[I]-(Vehicle.Length+CityData->Vehicles[J].Length)*.5;
            if(Gap>0.&&Gap<16.)Target=FMath::Min(Target,FMath::Max(0.,(Gap-3.)*.65));
        }
        if(FVector::DistSquared2D(Vehicle.Position,PlayerPosition)<FMath::Square(1050.))
        {
            const FVector Forward=(ToWorld(Edge->B)-ToWorld(Edge->A)).GetSafeNormal();const FVector Relative=PlayerPosition-Vehicle.Position;
            if(FVector::DotProduct(Relative,Forward)>0.&&FMath::Abs(FVector::DotProduct(Relative,FVector(-Forward.Y,Forward.X,0.)))<240.)Target=0.;
        }
        if(Edge->Length-Vehicle.Distance<8.)Target=FMath::Min(Target,4.);
        Vehicle.Speed=FMath::FInterpTo(Vehicle.Speed,Target,DT,Target<Vehicle.Speed?4.:.8);Vehicle.Distance+=Vehicle.Speed*DT;
        for(int32 Guard=0;Guard<12&&Vehicle.Distance>=Edge->Length;++Guard)
        {
            const auto& Next=CityData->Outgoing[Edge->To];int32 Chosen=INDEX_NONE;double Best=-1.e9;
            const FVector2D Incoming=(Edge->B-Edge->A).GetSafeNormal();
            for(int32 Candidate:Next)
            {
                const auto& Proposed=CityData->Edges[Candidate];const double Dot=FVector2D::DotProduct(Incoming,(Proposed.B-Proposed.A).GetSafeNormal());
                const double Score=(Dot<-.95?-20.:0.)+Dot*.8+CityData->Random.FRandRange(0.,1.3);
                if(Score>Best){Best=Score;Chosen=Candidate;}
            }
            if(Chosen==INDEX_NONE){Vehicle.Distance=Edge->Length-.01;Vehicle.Speed=0.;break;}
            Vehicle.Distance-=Edge->Length;Vehicle.Edge=Chosen;Edge=&CityData->Edges[Chosen];
        }
        const FVector2D D=(Edge->B-Edge->A).GetSafeNormal(),Right(-D.Y,D.X);
        const FVector2D MapPosition=Edge->A+D*FMath::Clamp(Vehicle.Distance,0.,Edge->Length)+Right*FMath::Clamp(Edge->Width*.24,.45,2.8);
        bool bClear=true;
        for(double Along:{-Vehicle.Length*.32,0.,Vehicle.Length*.32})
            if(!IsLocationClear(ToWorld(MapPosition+D*Along),95.f)){bClear=false;break;}
        if(!bClear&&DT>0.)
        {
            Vehicle.Edge=PreviousEdge;Vehicle.Distance=PreviousDistance;Vehicle.Speed=0.;
            continue;
        }
        Vehicle.Position=ToWorld(MapPosition,RoadHeight);const double DesiredYaw=(ToWorld(Edge->B)-ToWorld(Edge->A)).Rotation().Yaw;
        Vehicle.Yaw=DT>0.?FMath::FixedTurn(Vehicle.Yaw,DesiredYaw,180.*DT):DesiredYaw;
        for(const auto& Part:Vehicle.Parts)Part.Mesh->UpdateInstanceTransform(Part.Index,PartTransform(Part,Vehicle.Position,Vehicle.Yaw),false,false,true);
    }
    for(auto* Mesh:CityData->MovingMeshes)Mesh->MarkRenderStateDirty();
}

void AMansouraCity::BuildStreetActivity()
{
    using namespace MansouraCity;if(!CityData)return;
    const auto Make=[&](const TCHAR* Name,UStaticMesh* Mesh,const TCHAR* Mat,bool bMoving=false)
    {
        UInstancedStaticMeshComponent* C=bMoving?NewObject<UInstancedStaticMeshComponent>(this,FName(Name)):NewObject<UHierarchicalInstancedStaticMeshComponent>(this,FName(Name));
        C->SetupAttachment(CityRoot);C->SetMobility(bMoving?EComponentMobility::Movable:EComponentMobility::Static);C->SetStaticMesh(Mesh);C->SetMaterial(0,CityData->Materials[Mat]);C->SetCollisionEnabled(ECollisionEnabled::NoCollision);C->SetCanEverAffectNavigation(false);C->RegisterComponent();GeneratedComponents.Add(C);if(bMoving)CityData->MovingMeshes.Add(C);return C;
    };
    auto* Bodies=Make(TEXT("OriginalWalkingCrowd"),CubeMesh,TEXT("Blue"),true);auto* Heads=Make(TEXT("CrowdHeads"),SphereMesh,TEXT("Cream"),true);auto* Limbs=Make(TEXT("WalkingLimbs"),CubeMesh,TEXT("Rubber"),true);
    auto* Timber=Make(TEXT("OriginalStreetStallTables"),CubeMesh,TEXT("Wood"));auto* Fabric=Make(TEXT("OriginalScarfStands"),CubeMesh,TEXT("Scarf"));auto* Shoes=Make(TEXT("OriginalShoeStands"),SphereMesh,TEXT("Rubber"));
    auto* Trunks=Make(TEXT("PromenadePalmTrunks"),CylinderMesh,TEXT("Trunk"));auto* Leaves=Make(TEXT("PalmFronds"),CubeMesh,TEXT("Leaf"));
    const auto RoadClear=[&](const FVector2D& P,double Margin)
    {
        return CityData->RoadClear(P,Margin);
    };
    int32 StallCount=0,PalmCount=0;
    for(const auto& Value:Array(CityData->Map,TEXT("paths")))
    {
        if(Value->Type!=EJson::Object)continue;const FJson Path=Value->AsObject();const auto& Points=Array(Path,TEXT("points"));
        for(int32 I=0;I+1<Points.Num();++I)
        {
            const FVector2D A=Point(Points[I]->AsObject()),B=Point(Points[I+1]->AsObject());const double Length=FVector2D::Distance(A,B);if(Length<5.)continue;
            const FVector2D Center=(A+B)*.5;
            const bool bUniversity=Center.X>-2200.&&Center.X<-1050.&&Center.Y>-195.&&Center.Y<510.;
            bool bSafe=bUniversity&&Length<90.;
            for(int32 Sample=0;bSafe&&Sample<=12;++Sample){const FVector2D P=FMath::Lerp(A,B,Sample/12.);if(!IsLocationClear(ToWorld(P),40.f)||!RoadClear(P,.6))bSafe=false;}
            if(bSafe&&CityData->Walkers.Num()<FMath::Clamp(PedestrianCount,0,160))
            {
                const int32 Count=FMath::Clamp(static_cast<int32>(Length/7.),1,6);
                for(int32 P=0;P<Count&&CityData->Walkers.Num()<PedestrianCount;++P)
                {
                    FWalker Walker;Walker.A=A;Walker.B=B;Walker.Alpha=CityData->Random.FRand();Walker.Direction=P%2?1.:-1.;Walker.Speed=CityData->Random.FRandRange(.75,1.35);Walker.Phase=CityData->Random.FRandRange(0.,6.28);
                    if(!IsLocationClear(ToWorld(FMath::Lerp(A,B,Walker.Alpha)),45.f))continue;
                    const auto Part=[&](auto* Mesh,FVector Offset,FVector Size,double Gait=0.){FInstancePart Item;Item.Mesh=Mesh;Item.Offset=Offset;Item.Size=Size;Item.Gait=Gait;Item.Index=Mesh->AddInstance(FTransform(FVector(0.,0.,-20000.)));Walker.Parts.Add(Item);};
                    Part(Bodies,{0.,0.,1.06},{.30,.43,.65});Part(Heads,{0.,0.,1.61},{.24,.24,.27});
                    for(double Side:{-1.,1.}){Part(Limbs,{0.,Side*.105,.44},{.14,.14,.72},Side);Part(Bodies,{0.,Side*.28,1.03},{.12,.12,.6},-Side);}
                    CityData->Walkers.Add(MoveTemp(Walker));
                }
            }
            // Original, non-surveyed street activity, constrained to clear
            // walking space near mapped university entrances, never in roads.
            if(bUniversity&&Center.Y<35.&&StallCount<12&&Length>12.)
            {
                const FVector2D D=(B-A).GetSafeNormal(),Side(-D.Y,D.X);
                for(double Sign:{-1.,1.})
                {
                    const FVector2D P=Center+Side*(3.2*Sign);if(!IsLocationClear(ToWorld(P),210.f)||!RoadClear(P,2.6))continue;
                    const double Yaw=(ToWorld(B)-ToWorld(A)).Rotation().Yaw;const FVector Position=ToWorld(P,.04);
                    const auto Put=[&](auto* Mesh,FVector Offset,FVector Size){FInstancePart Part;Part.Offset=Offset;Part.Size=Size;Mesh->AddInstance(PartTransform(Part,Position,Yaw));};
                    Put(Timber,{0.,0.,.8},{2.5,1.1,.12});for(double X:{-1.05,1.05})for(double Y:{-.43,.43})Put(Timber,{X,Y,.4},{.08,.08,.8});
                    if(StallCount%2==0){for(int32 S=0;S<8;++S)Put(Shoes,{-.98+S*.28,.1,.95},{.26,.12,.1});}
                    else{for(double X:{-1.2,1.2})Put(Timber,{X,0.,1.5},{.06,.06,2.7});Put(Timber,{0.,0.,2.8},{2.5,.06,.06});for(int32 S=0;S<7;++S)Put(Fabric,{-.93+S*.31,0.,2.05},{.24,.035,1.1});}
                    ++StallCount;break;
                }
            }
            if(PalmCount<200&&Length>15.)
            {
                const FVector2D Side=FVector2D(-(B-A).Y,(B-A).X).GetSafeNormal();
                for(double T=8.;T<Length;T+=32.)
                {
                    const FVector2D P=A+(B-A)*(T/Length)+Side*2.3;
                    bool bNearNile=false;for(const auto& Water:CityData->Water)for(int32 E=0;E<Water.Outer.Num();++E)if(SegmentDistance(P,Water.Outer[E],Water.Outer[(E+1)%Water.Outer.Num()])<35.){bNearNile=true;break;}
                    if(!bNearNile||!IsLocationClear(ToWorld(P),140.f)||!RoadClear(P,1.5))continue;
                    Trunks->AddInstance(FTransform(FRotator::ZeroRotator,ToWorld(P,3.1),FVector(.27,.27,6.2)));
                    for(int32 F=0;F<9;++F){const double Angle=F*40.;const FVector Radial=FRotator(0.,Angle,0.).Vector();Leaves->AddInstance(FTransform(FRotator(-10.,Angle,0.),ToWorld(P,6.2)+Radial*160.,FVector(3.4,.34,.08)));}
                    ++PalmCount;
                }
            }
        }
    }
    UpdatePedestrians(0.);
    UE_LOG(LogMansouraCity,Display,TEXT("Original activity: %d walkers, %d shoe/scarf stands, %d palms; all checked against source footprints/water and road setbacks."),CityData->Walkers.Num(),StallCount,PalmCount);
}
void AMansouraCity::UpdatePedestrians(float DeltaSeconds)
{
    using namespace MansouraCity;if(!CityData)return;const double DT=FMath::Clamp(static_cast<double>(DeltaSeconds),0.,.05);
    for(auto& Walker:CityData->Walkers)
    {
        const double PreviousAlpha=Walker.Alpha;
        const double Length=FVector2D::Distance(Walker.A,Walker.B);Walker.Alpha+=Walker.Direction*Walker.Speed*DT/Length;
        if(Walker.Alpha>1.){Walker.Alpha=2.-Walker.Alpha;Walker.Direction=-1.;}else if(Walker.Alpha<0.){Walker.Alpha=-Walker.Alpha;Walker.Direction=1.;}
        const FVector2D MapPoint=FMath::Lerp(Walker.A,Walker.B,Walker.Alpha);
        if(!IsLocationClear(ToWorld(MapPoint),45.f)||!CityData->RoadClear(MapPoint,.6))
        {Walker.Alpha=PreviousAlpha;Walker.Direction*=-1.;}
        const FVector Position=ToWorld(FMath::Lerp(Walker.A,Walker.B,Walker.Alpha),.04);
        const FVector Direction=(ToWorld(Walker.B)-ToWorld(Walker.A))*Walker.Direction;Walker.Phase+=DT*Walker.Speed*6.;
        for(const auto& Part:Walker.Parts)Part.Mesh->UpdateInstanceTransform(Part.Index,PartTransform(Part,Position,Direction.Rotation().Yaw,Walker.Phase),false,false,true);
    }
    for(auto* Mesh:CityData->MovingMeshes)Mesh->MarkRenderStateDirty();
}
void AMansouraCity::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);if(!bCityLoaded)return;UpdateAmbientTraffic(DeltaSeconds);UpdatePedestrians(DeltaSeconds);
    if(bShowFootprintDebug&&CityData)
    {
        const APawn* Pawn=UGameplayStatics::GetPlayerPawn(this,0);const FVector Center=Pawn?Pawn->GetActorLocation():CityData->Start.GetLocation();
        for(const auto& Poly:CityData->Buildings)if(FVector::DistSquared2D(MansouraCity::ToWorld(Poly.Bounds.GetCenter()),Center)<FMath::Square(20000.))
            for(int32 I=0;I<Poly.Outer.Num();++I)DrawDebugLine(GetWorld(),MansouraCity::ToWorld(Poly.Outer[I],.2),MansouraCity::ToWorld(Poly.Outer[(I+1)%Poly.Outer.Num()],.2),FColor::Cyan,false,0.f,0,2.f);
    }
}
