#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "MansouraGameMode.generated.h"

class AMansouraCity;
class AMansouraTaxiPawn;

USTRUCT(BlueprintType)
struct FMansouraRiderAgreement
{
    GENERATED_BODY()
    UPROPERTY(BlueprintReadOnly) int32 Id = 0;
    UPROPERTY(BlueprintReadOnly) FString Name;
    UPROPERTY(BlueprintReadOnly) FString DestinationId;
    UPROPERTY(BlueprintReadOnly) FString DestinationName;
    UPROPERTY(BlueprintReadOnly) int32 AgreedFare = 0;
    UPROPERTY(BlueprintReadOnly) bool bSharingAccepted = false;
    UPROPERTY(BlueprintReadOnly) double BoardedAtMetres = 0.;
};

/** Small native four-rider loop. Prices and dialogue are original game fiction;
 *  agreements are independent and paid once at their own mapped road stop.
 *  The native prototype does not yet port the browser game's full negotiation
 *  engine or compute a shortest-road navigation route. */
UCLASS()
class MANSOURATAXI_API AMansouraGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AMansouraGameMode();
    virtual void StartPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    UFUNCTION(BlueprintCallable) void AskForFare();
    UFUNCTION(BlueprintCallable) void AcceptFare();
    UFUNCTION(BlueprintCallable) void RefuseFare();
    UFUNCTION(BlueprintCallable) void DiscussSharing();
    UFUNCTION(BlueprintCallable) void BoardOrDropOff();
    UFUNCTION(BlueprintCallable) void CycleDestination();
    UFUNCTION(BlueprintCallable) void ResetTaxiSafely();

    UFUNCTION(BlueprintPure) FText GetTelemetryText() const;
    UFUNCTION(BlueprintPure) FText GetJourneyText() const;
    UFUNCTION(BlueprintPure) FText GetCaptionText() const;
    UFUNCTION(BlueprintPure) bool HasPendingRequest() const { return Pending.bActive; }

    UPROPERTY(BlueprintReadOnly) TObjectPtr<AMansouraCity> City;
    UPROPERTY(BlueprintReadOnly) TArray<FMansouraRiderAgreement> Riders;
    UPROPERTY(BlueprintReadOnly) int32 ShiftIncome = 0;
    UPROPERTY(BlueprintReadOnly) int32 CompletedFares = 0;
    UPROPERTY(BlueprintReadOnly) double OdometerMetres = 0.;
    UPROPERTY(BlueprintReadOnly) FString SelectedDestinationId;

private:
    struct FRequest
    {
        bool bActive = false, bAgreed = false, bSharingDiscussed = false;
        int32 RiderId = 0, Fare = 0;
        FString Name, DestinationId, DestinationName;
        FVector Pickup = FVector::ZeroVector;
        double SecondsLeft = 0.;
    } Pending;
    UPROPERTY(Transient) TObjectPtr<AActor> DestinationMarker;
    FRandomStream FareRandom{98617};
    TArray<int32> SelectableDestinations;
    FVector PreviousTaxiPosition = FVector::ZeroVector;
    bool bHavePreviousPosition = false;
    int32 NextRiderId = 1;
    FString CaptionLineOne, CaptionLineTwo;
    double CaptionSecondsLeft = 0.;

    AMansouraTaxiPawn* Taxi() const;
    bool IsStopped() const;
    bool ResolveAccess(const FString& Id, FTransform& Access) const;
    void Say(const FString& One, const FString& Two, double Seconds = 8.);
    void RefreshDestinationMarker();
    void SelectNextOnboardDestination();
};
