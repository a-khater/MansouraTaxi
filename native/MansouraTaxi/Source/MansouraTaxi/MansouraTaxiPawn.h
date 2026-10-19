#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "MansouraTaxiPawn.generated.h"

class UAudioComponent;
class UBoxComponent;
class UCameraComponent;
class UInputComponent;
class USoundBase;
class USoundWaveProcedural;
class USpringArmComponent;
class UStaticMeshComponent;

USTRUCT(BlueprintType)
struct FMansouraTaxiWheelState
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    bool bGrounded = false;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    float SuspensionLengthCm = 36.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    float NormalLoadNewtons = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    float SlipAngleDegrees = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    float SteeringAngleDegrees = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Wheels")
    FVector ContactPosition = FVector::ZeroVector;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FMansouraTaxiHorn);

/**
 * Four trace-wheel sedan driven by forces on a Chaos-simulated chassis.
 * X is forward, Y is right, Z is up; distances are centimetres. Tire/spring
 * calculations use SI units and convert newtons to UE force units at the API.
 * This is an initial tunable model, not a measured Hyundai vehicle simulation.
 */
UCLASS()
class MANSOURATAXI_API AMansouraTaxiPawn : public APawn
{
    GENERATED_BODY()

public:
    AMansouraTaxiPawn();

    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Taxi|Components")
    TObjectPtr<UBoxComponent> Chassis;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Taxi|Components")
    TObjectPtr<UStaticMeshComponent> VehicleMesh;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Taxi|Components")
    TObjectPtr<USpringArmComponent> CameraBoom;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Taxi|Components")
    TObjectPtr<UCameraComponent> FollowCamera;

    /** Signed longitudinal road speed: negative while reversing. */
    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    float SpeedKmh = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    float EngineRPM = 850.0f;

    /** -1 reverse, 1..5 forward. */
    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    int32 CurrentGear = 1;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    int32 GroundedWheelCount = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    bool bHandbrakeActive = false;

    /** False means the visible box is an engineering placeholder, not a Verna. */
    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Assets")
    bool bHasVernaMesh = false;

    /** Front-left, front-right, rear-left, rear-right. */
    UPROPERTY(BlueprintReadOnly, Category = "Taxi|Telemetry")
    TArray<FMansouraTaxiWheelState> WheelStates;

    UPROPERTY(BlueprintAssignable, Category = "Taxi|Audio")
    FMansouraTaxiHorn OnHorn;

    /** Optional original/licensed recording. An original synthesized horn is the fallback. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Audio")
    TObjectPtr<USoundBase> HornSound;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Physics", meta = (ClampMin = "600", ClampMax = "3000", Units = "kg"))
    float ChassisMassKg = 1130.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Suspension", meta = (ClampMin = "15", ClampMax = "60", Units = "cm"))
    float SuspensionRestLengthCm = 36.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Suspension", meta = (ClampMin = "0", ClampMax = "30", Units = "cm"))
    float SuspensionDroopCm = 12.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Suspension", meta = (ClampMin = "10000", ClampMax = "90000"))
    float FrontSpringNewtonsPerMetre = 36000.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Suspension", meta = (ClampMin = "10000", ClampMax = "90000"))
    float RearSpringNewtonsPerMetre = 30000.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Suspension", meta = (ClampMin = "300", ClampMax = "8000"))
    float DamperNewtonsPerMetrePerSecond = 2800.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Tires", meta = (ClampMin = "0.2", ClampMax = "1.5"))
    float TireFrictionCoefficient = 0.95f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Tires", meta = (ClampMin = "10000", ClampMax = "100000"))
    float CorneringStiffnessNewtonsPerRadian = 46000.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Powertrain", meta = (ClampMin = "50", ClampMax = "300"))
    float PeakEngineTorqueNm = 135.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Taxi|Powertrain", meta = (ClampMin = "1500", ClampMax = "14000"))
    float ServiceBrakeForceNewtons = 8500.0f;

    UFUNCTION(BlueprintPure, Category = "Taxi|Telemetry")
    float GetSpeedKmh() const { return SpeedKmh; }

    UFUNCTION(BlueprintPure, Category = "Taxi|Telemetry")
    float GetEngineRPM() const { return EngineRPM; }

    UFUNCTION(BlueprintCallable, Category = "Taxi|Input")
    void SetThrottleInput(float Value);

    UFUNCTION(BlueprintCallable, Category = "Taxi|Input")
    void SetSteeringInput(float Value);

    UFUNCTION(BlueprintCallable, Category = "Taxi|Input")
    void SetBrakeInput(float Value);

    UFUNCTION(BlueprintCallable, Category = "Taxi|Input")
    void SetHandbrakeInput(bool bPressed);

    UFUNCTION(BlueprintCallable, Category = "Taxi|Input")
    void Horn();

    /** Caller supplies a clear pose, with chassis origin about 75 cm above road. */
    UFUNCTION(BlueprintCallable, Category = "Taxi|Recovery")
    void ResetVehicleAt(FVector Location, FRotator Rotation);

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere, Category = "Taxi|Components")
    TArray<TObjectPtr<UStaticMeshComponent>> WheelVisuals;

    UPROPERTY(VisibleAnywhere, Category = "Taxi|Components")
    TObjectPtr<UAudioComponent> HornAudio;

    UPROPERTY(Transient)
    TObjectPtr<USoundWaveProcedural> SynthesizedHorn;

    FVector WheelMounts[4];
    float WheelRotationDegrees[4] = { 0, 0, 0, 0 };
    float ThrottleInput = 0.0f;
    float SteeringInput = 0.0f;
    float BrakeInput = 0.0f;
    float SmoothedSteering = 0.0f;
    float AppliedThrottle = 0.0f;
    float AppliedServiceBrake = 0.0f;
    float DriveForceNewtons = 0.0f;
    float GearChangeCooldown = 0.0f;
    float LastHornTime = -10.0f;

    void HandbrakePressed();
    void HandbrakeReleased();
    void UpdatePowertrain(float DeltaSeconds, float LongitudinalSpeedMps);
    void SimulateWheels(float DeltaSeconds);
    void UpdateCamera(float DeltaSeconds);
    float GetWheelSteeringDegrees(int32 WheelIndex, float LongitudinalSpeedMps) const;
};
