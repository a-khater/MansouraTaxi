#include "MansouraController.h"

#include "MansouraGameMode.h"
#include "MansouraOverlay.h"
#include "MansouraTaxiPawn.h"
#include "Components/InputComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

AMansouraController::AMansouraController()
{
    bShowMouseCursor = false;
    bEnableClickEvents = false;
    bEnableMouseOverEvents = false;
    PrimaryActorTick.bCanEverTick = true;
}
void AMansouraController::BeginPlay()
{
    Super::BeginPlay();
    SetInputMode(FInputModeGameOnly());
    if (IsLocalController())
    {
        Overlay = CreateWidget<UMansouraOverlay>(this, UMansouraOverlay::StaticClass());
        if (Overlay) { Overlay->AddToViewport(5); Overlay->SetVisibility(ESlateVisibility::HitTestInvisible); }
    }
}
void AMansouraController::SetupInputComponent()
{
    Super::SetupInputComponent();
    InputComponent->BindAction(TEXT("NextDestination"), IE_Pressed, this, &AMansouraController::NextDestination);
    InputComponent->BindAction(TEXT("ToggleHUD"), IE_Pressed, this, &AMansouraController::ToggleOverlay).bExecuteWhenPaused = true;
    InputComponent->BindAction(TEXT("Pause"), IE_Pressed, this, &AMansouraController::PauseOrResume).bExecuteWhenPaused = true;
    InputComponent->BindAction(TEXT("Ask"), IE_Pressed, this, &AMansouraController::Ask);
    InputComponent->BindAction(TEXT("Accept"), IE_Pressed, this, &AMansouraController::Accept);
    InputComponent->BindAction(TEXT("Refuse"), IE_Pressed, this, &AMansouraController::Refuse);
    InputComponent->BindAction(TEXT("Share"), IE_Pressed, this, &AMansouraController::Share);
    InputComponent->BindAction(TEXT("Interact"), IE_Pressed, this, &AMansouraController::Interact);
    InputComponent->BindAction(TEXT("ResetTaxi"), IE_Pressed, this, &AMansouraController::ResetTaxi);
}
void AMansouraController::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    HUDRefreshSeconds-=DeltaSeconds;
    if(HUDRefreshSeconds<=0.f&&Overlay&&bOverlayVisible){HUDRefreshSeconds=.1f;Overlay->RefreshHUD();}
}
AMansouraGameMode* AMansouraController::Shift() const { return GetWorld() ? GetWorld()->GetAuthGameMode<AMansouraGameMode>() : nullptr; }
void AMansouraController::NextDestination() { if (auto* Game = Shift()) Game->CycleDestination(); }
void AMansouraController::ToggleOverlay()
{
    bOverlayVisible = !bOverlayVisible;
    if (Overlay) Overlay->SetVisibility(bOverlayVisible ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
}
void AMansouraController::PauseOrResume()
{
    const bool bPause = !UGameplayStatics::IsGamePaused(this);
    if (auto* Pawn = Cast<AMansouraTaxiPawn>(GetPawn()))
    { Pawn->SetThrottleInput(0.f); Pawn->SetSteeringInput(0.f); Pawn->SetBrakeInput(bPause ? 1.f : 0.f); }
    SetPause(bPause);
    SetInputMode(FInputModeGameOnly()); bShowMouseCursor = false;
    if(Overlay)Overlay->RefreshHUD();
}
void AMansouraController::Ask() { if (auto* Game = Shift()) Game->AskForFare(); }
void AMansouraController::Accept() { if (auto* Game = Shift()) Game->AcceptFare(); }
void AMansouraController::Refuse() { if (auto* Game = Shift()) Game->RefuseFare(); }
void AMansouraController::Share() { if (auto* Game = Shift()) Game->DiscussSharing(); }
void AMansouraController::Interact() { if (auto* Game = Shift()) Game->BoardOrDropOff(); }
void AMansouraController::ResetTaxi() { if (auto* Game = Shift()) Game->ResetTaxiSafely(); }
