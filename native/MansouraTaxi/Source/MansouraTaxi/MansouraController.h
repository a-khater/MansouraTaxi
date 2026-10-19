#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "MansouraController.generated.h"

class UMansouraOverlay;
class AMansouraGameMode;

UCLASS()
class MANSOURATAXI_API AMansouraController : public APlayerController
{
    GENERATED_BODY()
public:
    AMansouraController();
    virtual void SetupInputComponent() override;
    virtual void Tick(float DeltaSeconds) override;
protected:
    virtual void BeginPlay() override;
private:
    UPROPERTY(Transient) TObjectPtr<UMansouraOverlay> Overlay;
    bool bOverlayVisible = true;
    float HUDRefreshSeconds = 0.f;
    AMansouraGameMode* Shift() const;
    void NextDestination();
    void ToggleOverlay();
    void PauseOrResume();
    void Ask();
    void Accept();
    void Refuse();
    void Share();
    void Interact();
    void ResetTaxi();
};
