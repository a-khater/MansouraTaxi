#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Components/TextBlock.h"
#include "MansouraOverlay.generated.h"

/** Slate's full text shaping and automatic bidirectional flow preserve Arabic
 *  joining. These are UMG text widgets, never unshaped Canvas draw strings. */
UCLASS()
class MANSOURATAXI_API UMansouraShapedText : public UTextBlock
{
    GENERATED_BODY()
public:
    UMansouraShapedText(const FObjectInitializer& ObjectInitializer);
};

/** Transparent corner telemetry plus a small two-line caption. No backgrounds,
 *  buttons, modal panels or pointer hit targets obstruct the driving view. */
UCLASS()
class MANSOURATAXI_API UMansouraOverlay : public UUserWidget
{
    GENERATED_BODY()
public:
    UMansouraOverlay(const FObjectInitializer& ObjectInitializer);
    void RefreshHUD();
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;
private:
    UPROPERTY(Transient) TObjectPtr<UMansouraShapedText> Telemetry;
    UPROPERTY(Transient) TObjectPtr<UMansouraShapedText> Journey;
    UPROPERTY(Transient) TObjectPtr<UMansouraShapedText> Caption;
    UPROPERTY(Transient) TObjectPtr<UMansouraShapedText> Attribution;
    UPROPERTY(Transient) TObjectPtr<UMansouraShapedText> Controls;
    float RefreshSeconds = 0.f;
};
