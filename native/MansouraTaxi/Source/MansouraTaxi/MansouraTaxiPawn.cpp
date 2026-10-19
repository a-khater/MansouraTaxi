#include "MansouraTaxiPawn.h"

#include "Camera/CameraComponent.h"
#include "CollisionQueryParams.h"
#include "Components/AudioComponent.h"
#include "Components/BoxComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/SpringArmComponent.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "PhysicsEngine/BodyInstance.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundWaveProcedural.h"
#include "UObject/ConstructorHelpers.h"

namespace MansouraTaxiPhysics
{
    constexpr float MetresPerCentimetre = 0.01f;
    constexpr float CentimetresPerMetre = 100.0f;
    constexpr float WheelRadiusCm = 29.7f;
    constexpr float WheelbaseCm = 244.0f;
    constexpr float HalfTrackCm = 74.0f;
    constexpr float IdleRPM = 850.0f;
    constexpr float RedlineRPM = 6500.0f;
    constexpr float FinalDrive = 4.04f;
    constexpr float ForwardRatios[] = { 3.62f, 2.05f, 1.37f, 1.03f, 0.84f };

    float FiniteInput(float Value)
    {
        return FMath::IsFinite(Value) ? FMath::Clamp(Value, -1.0f, 1.0f) : 0.0f;
    }
}

AMansouraTaxiPawn::AMansouraTaxiPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PrePhysics;
    AutoPossessPlayer = EAutoReceiveInput::Player0;
    bUseControllerRotationPitch = false;
    bUseControllerRotationYaw = false;
    bUseControllerRotationRoll = false;

    Chassis = CreateDefaultSubobject<UBoxComponent>(TEXT("Chassis"));
    SetRootComponent(Chassis);
    Chassis->SetBoxExtent(FVector(213.0f, 84.0f, 38.0f));
    Chassis->SetCollisionProfileName(UCollisionProfile::PhysicsActor_ProfileName);
    Chassis->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
    Chassis->SetSimulatePhysics(true);
    Chassis->SetEnableGravity(true);
    Chassis->SetLinearDamping(0.025f);
    Chassis->SetAngularDamping(0.35f);
    Chassis->BodyInstance.bUseCCD = true;

    VehicleMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VehicleMesh"));
    VehicleMesh->SetupAttachment(Chassis);
    VehicleMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    VehicleMesh->SetGenerateOverlapEvents(false);

    // These engine primitives are deliberately only an engineering proxy.
    // The optional imported Verna is loaded explicitly in BeginPlay below.
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    if (Cube.Succeeded())
    {
        VehicleMesh->SetStaticMesh(Cube.Object);
        VehicleMesh->SetRelativeScale3D(FVector(4.26f, 1.68f, 0.76f));
    }

    WheelMounts[0] = FVector(122.0f, -74.0f, -5.0f);
    WheelMounts[1] = FVector(122.0f, 74.0f, -5.0f);
    WheelMounts[2] = FVector(-122.0f, -74.0f, -5.0f);
    WheelMounts[3] = FVector(-122.0f, 74.0f, -5.0f);
    WheelStates.SetNum(4);
    const TCHAR* WheelNames[] = { TEXT("FrontLeftWheel"), TEXT("FrontRightWheel"), TEXT("RearLeftWheel"), TEXT("RearRightWheel") };
    for (int32 Index = 0; Index < 4; ++Index)
    {
        UStaticMeshComponent* Wheel = CreateDefaultSubobject<UStaticMeshComponent>(WheelNames[Index]);
        Wheel->SetupAttachment(Chassis);
        Wheel->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Wheel->SetGenerateOverlapEvents(false);
        if (Cylinder.Succeeded()) Wheel->SetStaticMesh(Cylinder.Object);
        Wheel->SetRelativeScale3D(FVector(0.594f, 0.594f, 0.195f));
        Wheel->SetRelativeRotation(FRotator(0, 0, 90));
        Wheel->SetRelativeLocation(WheelMounts[Index] - FVector(0, 0, SuspensionRestLengthCm));
        WheelVisuals.Add(Wheel);
    }

    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
    CameraBoom->SetupAttachment(Chassis);
    CameraBoom->TargetArmLength = 620.0f;
    CameraBoom->TargetOffset = FVector(0, 0, 80.0f);
    CameraBoom->SocketOffset = FVector(0, 0, 10.0f);
    CameraBoom->SetRelativeRotation(FRotator(-12.0f, 0, 0));
    CameraBoom->bUsePawnControlRotation = false;
    CameraBoom->bInheritPitch = false;
    CameraBoom->bInheritYaw = true;
    CameraBoom->bInheritRoll = false;
    CameraBoom->bEnableCameraLag = true;
    CameraBoom->CameraLagSpeed = 6.5f;
    CameraBoom->bUseCameraLagSubstepping = true;
    CameraBoom->CameraLagMaxTimeStep = 1.0f / 60.0f;
    CameraBoom->bEnableCameraRotationLag = true;
    CameraBoom->CameraRotationLagSpeed = 7.0f;
    CameraBoom->ProbeSize = 15.0f;
    CameraBoom->ProbeChannel = ECC_Camera;
    FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
    FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
    FollowCamera->bUsePawnControlRotation = false;
    FollowCamera->SetFieldOfView(70.0f);

    HornAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("HornAudio"));
    HornAudio->SetupAttachment(Chassis);
    HornAudio->bAutoActivate = false;
    HornAudio->bAllowSpatialization = true;
    HornAudio->bOverrideAttenuation = true;
    HornAudio->AttenuationOverrides.bAttenuate = true;
    HornAudio->AttenuationOverrides.bSpatialize = true;
    HornAudio->AttenuationOverrides.AttenuationShapeExtents = FVector(1200.0f, 0, 0);
    HornAudio->AttenuationOverrides.FalloffDistance = 8000.0f;
}

void AMansouraTaxiPawn::BeginPlay()
{
    Super::BeginPlay();
    Chassis->SetMassOverrideInKg(NAME_None, ChassisMassKg, true);
    Chassis->SetCenterOfMass(FVector(14.0f, 0, -7.0f));

    UStaticMesh* Verna = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Mansoura/Vehicles/SM_Verna.SM_Verna"));
    bHasVernaMesh = Verna != nullptr;
    if (Verna)
    {
        // Import a complete vehicle in centimetres, X forward, ground-level pivot.
        VehicleMesh->SetStaticMesh(Verna);
        VehicleMesh->SetRelativeScale3D(FVector::OneVector);
        VehicleMesh->SetRelativeLocation(FVector(0, 0, -63.0f));
        // A complete static mesh has no independently rigged wheel nodes.
        // Separate production wheel meshes are needed to animate that asset.
        for (UStaticMeshComponent* Wheel : WheelVisuals) Wheel->SetVisibility(false);
    }
    else
    {
        UE_LOG(LogTemp, Warning, TEXT("SM_Verna is absent. Taxi physics uses a visible engineering box/cylinder proxy; a realistic vehicle asset has not been supplied."));
    }
}

void AMansouraTaxiPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    check(PlayerInputComponent);
    PlayerInputComponent->BindAxis(TEXT("Throttle"), this, &AMansouraTaxiPawn::SetThrottleInput);
    PlayerInputComponent->BindAxis(TEXT("Steer"), this, &AMansouraTaxiPawn::SetSteeringInput);
    PlayerInputComponent->BindAxis(TEXT("Brake"), this, &AMansouraTaxiPawn::SetBrakeInput);
    PlayerInputComponent->BindAction(TEXT("Handbrake"), IE_Pressed, this, &AMansouraTaxiPawn::HandbrakePressed);
    PlayerInputComponent->BindAction(TEXT("Handbrake"), IE_Released, this, &AMansouraTaxiPawn::HandbrakeReleased);
    PlayerInputComponent->BindAction(TEXT("Horn"), IE_Pressed, this, &AMansouraTaxiPawn::Horn);
}

void AMansouraTaxiPawn::SetThrottleInput(float Value)
{
    ThrottleInput = MansouraTaxiPhysics::FiniteInput(Value);
    if (FMath::Abs(ThrottleInput) > KINDA_SMALL_NUMBER) Chassis->WakeAllRigidBodies();
}

void AMansouraTaxiPawn::SetSteeringInput(float Value)
{
    SteeringInput = MansouraTaxiPhysics::FiniteInput(Value);
}

void AMansouraTaxiPawn::SetBrakeInput(float Value)
{
    BrakeInput = FMath::Max(0.0f, MansouraTaxiPhysics::FiniteInput(Value));
}

void AMansouraTaxiPawn::SetHandbrakeInput(bool bPressed)
{
    bHandbrakeActive = bPressed;
    if (bPressed) Chassis->WakeAllRigidBodies();
}

void AMansouraTaxiPawn::HandbrakePressed() { SetHandbrakeInput(true); }
void AMansouraTaxiPawn::HandbrakeReleased() { SetHandbrakeInput(false); }

void AMansouraTaxiPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!FMath::IsFinite(DeltaSeconds) || DeltaSeconds <= 0 || !Chassis->IsSimulatingPhysics()) return;
    // Forces are submitted once during PrePhysics, never multiplied by dt.
    // Chaos substepping should be enabled in project settings. Suspension traces
    // are game-thread samples; native frame-rate/substep tuning still needs QA.
    const float Step = FMath::Clamp(DeltaSeconds, 1.0f / 240.0f, 0.05f);
    const FVector VelocityMps = Chassis->GetPhysicsLinearVelocity() * MansouraTaxiPhysics::MetresPerCentimetre;
    const float LongitudinalSpeed = FVector::DotProduct(VelocityMps, GetActorForwardVector());
    SpeedKmh = LongitudinalSpeed * 3.6f;
    SmoothedSteering = FMath::FInterpTo(SmoothedSteering, SteeringInput, Step, 5.5f);
    UpdatePowertrain(Step, LongitudinalSpeed);
    SimulateWheels(Step);

    // CdA is a starting sedan calibration; there is no artificial speed clamp.
    const FVector DragNewtons = -0.5f * 1.225f * 0.68f * VelocityMps.Size() * VelocityMps;
    Chassis->AddForce(DragNewtons * MansouraTaxiPhysics::CentimetresPerMetre);
    UpdateCamera(Step);
}

void AMansouraTaxiPawn::UpdatePowertrain(float DeltaSeconds, float LongitudinalSpeedMps)
{
    using namespace MansouraTaxiPhysics;
    GearChangeCooldown = FMath::Max(0.0f, GearChangeCooldown - DeltaSeconds);
    AppliedThrottle = FMath::Abs(ThrottleInput);
    AppliedServiceBrake = BrakeInput;
    const int32 RequestedDirection = ThrottleInput < -0.05f ? -1 : ThrottleInput > 0.05f ? 1 : 0;
    if (RequestedDirection != 0 && RequestedDirection * LongitudinalSpeedMps < -0.8f)
    {
        // S first brakes a forward-moving taxi; reverse engages only near rest.
        AppliedServiceBrake = FMath::Max(AppliedServiceBrake, AppliedThrottle);
        AppliedThrottle = 0.0f;
    }
    else if (RequestedDirection != 0 && RequestedDirection != (CurrentGear < 0 ? -1 : 1))
    {
        CurrentGear = RequestedDirection;
        GearChangeCooldown = 0.5f;
    }

    float Ratio = CurrentGear < 0 ? 3.58f : ForwardRatios[FMath::Clamp(CurrentGear - 1, 0, 4)];
    const float RoadWheelRPM = FMath::Abs(LongitudinalSpeedMps) / (WheelRadiusCm * MetresPerCentimetre) * 60.0f / (2.0f * PI);
    float CoupledRPM = RoadWheelRPM * Ratio * FinalDrive;
    if (CurrentGear > 0 && GearChangeCooldown <= 0.0f)
    {
        if (CoupledRPM > 4800.0f && CurrentGear < 5) { ++CurrentGear; GearChangeCooldown = 0.65f; }
        else if (CoupledRPM < 1550.0f && CurrentGear > 1) { --CurrentGear; GearChangeCooldown = 0.65f; }
        Ratio = ForwardRatios[CurrentGear - 1];
        CoupledRPM = RoadWheelRPM * Ratio * FinalDrive;
    }
    const float ClutchRPM = FMath::Lerp(IdleRPM, 1700.0f, AppliedThrottle);
    const float TargetRPM = FMath::Clamp(FMath::Max(ClutchRPM, CoupledRPM), IdleRPM, RedlineRPM);
    EngineRPM = FMath::FInterpTo(EngineRPM, TargetRPM, DeltaSeconds, 9.0f);
    const float CurvePosition = (EngineRPM - 3600.0f) / 2600.0f;
    const float TorqueFraction = 0.55f + 0.45f * FMath::Exp(-CurvePosition * CurvePosition);
    const float ShiftClutch = GearChangeCooldown > 0.45f ? 0.3f : 1.0f;
    const float RevLimiter = CoupledRPM > RedlineRPM ? 0.0f : 1.0f;
    DriveForceNewtons = AppliedThrottle * PeakEngineTorqueNm * TorqueFraction * Ratio * FinalDrive * 0.88f
        / (WheelRadiusCm * MetresPerCentimetre) * ShiftClutch * RevLimiter * (CurrentGear < 0 ? -1.0f : 1.0f);
}

float AMansouraTaxiPawn::GetWheelSteeringDegrees(int32 WheelIndex, float LongitudinalSpeedMps) const
{
    using namespace MansouraTaxiPhysics;
    if (WheelIndex > 1) return 0.0f;
    const float SpeedFraction = FMath::Clamp(FMath::Abs(LongitudinalSpeedMps) / 32.0f, 0.0f, 1.0f);
    const float CentreDegrees = SmoothedSteering * FMath::Lerp(32.0f, 9.0f, SpeedFraction);
    if (FMath::Abs(CentreDegrees) < 0.01f) return 0.0f;
    const float TurnRadius = WheelbaseCm / FMath::Tan(FMath::DegreesToRadians(FMath::Abs(CentreDegrees)));
    const bool bInsideWheel = CentreDegrees * WheelMounts[WheelIndex].Y > 0.0f;
    const float WheelRadius = FMath::Max(50.0f, TurnRadius + (bInsideWheel ? -HalfTrackCm : HalfTrackCm));
    return FMath::RadiansToDegrees(FMath::Atan(WheelbaseCm / WheelRadius)) * FMath::Sign(CentreDegrees);
}

void AMansouraTaxiPawn::SimulateWheels(float DeltaSeconds)
{
    using namespace MansouraTaxiPhysics;
    const FTransform BodyTransform = Chassis->GetComponentTransform();
    const FVector Up = BodyTransform.GetUnitAxis(EAxis::Z);
    const FVector Forward = BodyTransform.GetUnitAxis(EAxis::X);
    const float LongitudinalSpeedMps = SpeedKmh / 3.6f;
    FCollisionQueryParams Query(SCENE_QUERY_STAT(TaxiWheelSuspension), false, this);
    Query.bReturnPhysicalMaterial = true;
    FHitResult Hits[4];
    float Loads[4] = { 0, 0, 0, 0 };
    GroundedWheelCount = 0;

    // Sample all four contacts first so tire damping uses the actual number of
    // supported corners rather than assigning four-car mass to an airborne axle.
    for (int32 Index = 0; Index < 4; ++Index)
    {
        FMansouraTaxiWheelState& Wheel = WheelStates[Index];
        Wheel.bGrounded = false;
        Wheel.NormalLoadNewtons = 0;
        Wheel.SlipAngleDegrees = 0;
        Wheel.SteeringAngleDegrees = GetWheelSteeringDegrees(Index, LongitudinalSpeedMps);
        Wheel.SuspensionLengthCm = SuspensionRestLengthCm + SuspensionDroopCm;
        const FVector Mount = BodyTransform.TransformPosition(WheelMounts[Index]);
        const FVector End = Mount - Up * (SuspensionRestLengthCm + SuspensionDroopCm + WheelRadiusCm);
        Wheel.ContactPosition = End;
        if (GetWorld()->LineTraceSingleByChannel(Hits[Index], Mount, End, ECC_Visibility, Query)
            && FVector::DotProduct(Hits[Index].ImpactNormal, Up) > 0.25f)
        {
            const FHitResult& Hit = Hits[Index];
            Wheel.bGrounded = true;
            ++GroundedWheelCount;
            Wheel.ContactPosition = Hit.ImpactPoint;
            Wheel.SuspensionLengthCm = FMath::Clamp(Hit.Distance - WheelRadiusCm, 0.0f, SuspensionRestLengthCm + SuspensionDroopCm);
            FVector SurfaceVelocity = FVector::ZeroVector;
            if (UPrimitiveComponent* Surface = Hit.GetComponent())
                SurfaceVelocity = Surface->IsSimulatingPhysics() ? Surface->GetPhysicsLinearVelocityAtPoint(Hit.ImpactPoint) : Surface->GetComponentVelocity();
            const FVector RelativeVelocity = Chassis->GetPhysicsLinearVelocityAtPoint(Mount) - SurfaceVelocity;
            const float SpringVelocityMps = FVector::DotProduct(RelativeVelocity, Up) * MetresPerCentimetre;
            const float CompressionMetres = FMath::Max(0.0f, SuspensionRestLengthCm - Wheel.SuspensionLengthCm) * MetresPerCentimetre;
            const float SpringRate = Index < 2 ? FrontSpringNewtonsPerMetre : RearSpringNewtonsPerMetre;
            const float BumpStop = FMath::Max(0.0f, 10.0f - Wheel.SuspensionLengthCm) * MetresPerCentimetre * 120000.0f;
            const float SpringNewtons = FMath::Clamp(SpringRate * CompressionMetres - DamperNewtonsPerMetrePerSecond * SpringVelocityMps + BumpStop, 0.0f, 14500.0f);
            Loads[Index] = SpringNewtons * FMath::Max(0.0f, static_cast<float>(FVector::DotProduct(Up, Hit.ImpactNormal)));
            Wheel.NormalLoadNewtons = Loads[Index];
            Chassis->AddForceAtLocation(Up * SpringNewtons * CentimetresPerMetre, Mount);
        }
    }

    const float SupportedMassPerWheel = ChassisMassKg / FMath::Max(1, GroundedWheelCount);
    for (int32 Index = 0; Index < 4; ++Index)
    {
        const FMansouraTaxiWheelState& Wheel = WheelStates[Index];
        float LongSpeed = LongitudinalSpeedMps;
        if (Wheel.bGrounded && Loads[Index] > 1.0f)
        {
            const FHitResult& Hit = Hits[Index];
            const FVector Steered = FQuat(Up, FMath::DegreesToRadians(Wheel.SteeringAngleDegrees)).RotateVector(Forward);
            const FVector WheelForward = FVector::VectorPlaneProject(Steered, Hit.ImpactNormal).GetSafeNormal();
            const FVector WheelRight = FVector::CrossProduct(Hit.ImpactNormal, WheelForward).GetSafeNormal();
            FVector SurfaceVelocity = FVector::ZeroVector;
            if (UPrimitiveComponent* Surface = Hit.GetComponent())
                SurfaceVelocity = Surface->IsSimulatingPhysics() ? Surface->GetPhysicsLinearVelocityAtPoint(Hit.ImpactPoint) : Surface->GetComponentVelocity();
            const FVector Velocity = (Chassis->GetPhysicsLinearVelocityAtPoint(Hit.ImpactPoint) - SurfaceVelocity) * MetresPerCentimetre;
            LongSpeed = FVector::DotProduct(Velocity, WheelForward);
            const float LateralSpeed = FVector::DotProduct(Velocity, WheelRight);
            const float SlipAngle = FMath::Atan2(LateralSpeed, FMath::Abs(LongSpeed) + 1.5f);
            WheelStates[Index].SlipAngleDegrees = FMath::RadiansToDegrees(SlipAngle);
            float LateralForce = -CorneringStiffnessNewtonsPerRadian * SlipAngle;
            const float StopLateralForce = FMath::Abs(LateralSpeed) * SupportedMassPerWheel / DeltaSeconds;
            LateralForce = FMath::Clamp(LateralForce, -StopLateralForce, StopLateralForce);

            const bool bFront = Index < 2;
            const float BrakeCapacity = AppliedServiceBrake * ServiceBrakeForceNewtons * (bFront ? 0.31f : 0.19f)
                + ((!bFront && bHandbrakeActive) ? 4500.0f : 0.0f);
            const FVector GravityMps2(0, 0, GetWorld()->GetGravityZ() * MetresPerCentimetre);
            const float GradeForce = SupportedMassPerWheel * FVector::DotProduct(GravityMps2, WheelForward);
            const float DesiredBrake = -LongSpeed * SupportedMassPerWheel / DeltaSeconds - GradeForce;
            const float BrakingForce = FMath::Clamp(DesiredBrake, -BrakeCapacity, BrakeCapacity);
            const float RollingCapacity = Loads[Index] * 0.015f;
            const float RollingForce = -FMath::Sign(LongSpeed) * FMath::Min(RollingCapacity, FMath::Abs(LongSpeed) * SupportedMassPerWheel / DeltaSeconds);
            // Front-wheel drive; releasing the accelerator produces mild engine drag.
            const float EngineDrag = bFront && AppliedThrottle < 0.05f ? -LongSpeed * 22.0f : 0.0f;
            float LongForce = (bFront ? DriveForceNewtons * 0.5f : 0.0f) + BrakingForce + RollingForce + EngineDrag;
            const float SurfaceGrip = Hit.PhysMaterial.IsValid() ? FMath::Clamp(Hit.PhysMaterial->Friction / 0.7f, 0.25f, 1.35f) : 1.0f;
            const float MaxLongForce = FMath::Max(1.0f, Loads[Index] * TireFrictionCoefficient * SurfaceGrip);
            const float MaxLateralForce = MaxLongForce * ((!bFront && bHandbrakeActive) ? 0.28f : 1.0f);
            const float FrictionUsage = FMath::Sqrt(FMath::Square(LongForce / MaxLongForce) + FMath::Square(LateralForce / MaxLateralForce));
            if (FrictionUsage > 1.0f) { LongForce /= FrictionUsage; LateralForce /= FrictionUsage; }
            Chassis->AddForceAtLocation((WheelForward * LongForce + WheelRight * LateralForce) * CentimetresPerMetre, Hit.ImpactPoint);
        }

        if (!bHasVernaMesh && WheelVisuals.IsValidIndex(Index))
        {
            if (!(Index >= 2 && bHandbrakeActive))
                WheelRotationDegrees[Index] = FMath::Fmod(WheelRotationDegrees[Index] + FMath::RadiansToDegrees(LongSpeed / (WheelRadiusCm * MetresPerCentimetre) * DeltaSeconds), 360.0f);
            WheelVisuals[Index]->SetRelativeLocation(WheelMounts[Index] - FVector(0, 0, Wheel.SuspensionLengthCm));
            WheelVisuals[Index]->SetRelativeRotation(FRotator(WheelRotationDegrees[Index], Wheel.SteeringAngleDegrees, 90.0f));
        }
    }
}

void AMansouraTaxiPawn::UpdateCamera(float DeltaSeconds)
{
    const float SpeedFraction = FMath::Clamp(FMath::Abs(SpeedKmh) / 140.0f, 0.0f, 1.0f);
    CameraBoom->TargetArmLength = FMath::FInterpTo(CameraBoom->TargetArmLength, FMath::Lerp(580.0f, 760.0f, SpeedFraction), DeltaSeconds, 2.0f);
    FollowCamera->SetFieldOfView(FMath::FInterpTo(FollowCamera->FieldOfView, FMath::Lerp(70.0f, 77.0f, SpeedFraction), DeltaSeconds, 2.0f));
}

void AMansouraTaxiPawn::Horn()
{
    if (!GetWorld() || GetWorld()->GetTimeSeconds() - LastHornTime < 0.3f) return;
    LastHornTime = GetWorld()->GetTimeSeconds();
    if (HornSound)
    {
        HornAudio->SetSound(HornSound);
    }
    else
    {
        // Original two-tone synthesis; no borrowed taxi sample or recording.
        constexpr int32 SampleRate = 22050;
        constexpr float DurationSeconds = 0.42f;
        const int32 SampleCount = FMath::RoundToInt(SampleRate * DurationSeconds);
        TArray<int16> Samples;
        Samples.SetNumUninitialized(SampleCount);
        for (int32 Index = 0; Index < SampleCount; ++Index)
        {
            const float Time = static_cast<float>(Index) / SampleRate;
            const float Envelope = FMath::Min(1.0f, Time / 0.018f) * FMath::Clamp((DurationSeconds - Time) / 0.065f, 0.0f, 1.0f);
            const float Tone = 0.55f * FMath::Sin(2.0f * PI * 370.0f * Time) + 0.35f * FMath::Sin(2.0f * PI * 465.0f * Time);
            Samples[Index] = static_cast<int16>(FMath::Clamp(Tone * Envelope * 14000.0f, -32767.0f, 32767.0f));
        }
        SynthesizedHorn = NewObject<USoundWaveProcedural>(this);
        SynthesizedHorn->SetSampleRate(SampleRate);
        SynthesizedHorn->NumChannels = 1;
        SynthesizedHorn->Duration = DurationSeconds;
        SynthesizedHorn->bLooping = false;
        SynthesizedHorn->QueueAudio(reinterpret_cast<const uint8*>(Samples.GetData()), Samples.Num() * static_cast<int32>(sizeof(int16)));
        HornAudio->SetSound(SynthesizedHorn);
    }
    HornAudio->Play();
    OnHorn.Broadcast();
}

void AMansouraTaxiPawn::ResetVehicleAt(FVector Location, FRotator Rotation)
{
    if (Location.ContainsNaN() || Rotation.ContainsNaN()) return;
    Chassis->SetPhysicsLinearVelocity(FVector::ZeroVector);
    Chassis->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
    SetActorLocationAndRotation(Location, Rotation, false, nullptr, ETeleportType::TeleportPhysics);
    Chassis->WakeAllRigidBodies();
    ThrottleInput = SteeringInput = BrakeInput = SmoothedSteering = 0.0f;
    AppliedThrottle = AppliedServiceBrake = DriveForceNewtons = GearChangeCooldown = 0.0f;
    SpeedKmh = 0.0f;
    EngineRPM = MansouraTaxiPhysics::IdleRPM;
    CurrentGear = 1;
    bHandbrakeActive = false;
    GroundedWheelCount = 0;
    for (FMansouraTaxiWheelState& Wheel : WheelStates) Wheel = FMansouraTaxiWheelState();
    for (float& WheelAngle : WheelRotationDegrees) WheelAngle = 0.0f;
}
