#include "MansouraOverlay.h"

#include "MansouraGameMode.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/TextWidgetTypes.h"
#include "Engine/World.h"
#include "Styling/CoreStyle.h"

UMansouraShapedText::UMansouraShapedText(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
{
    // Public UMG API persists shaping through property synchronization and
    // avoids depending on UTextBlock's internal Slate member across versions.
    FShapedTextOptions Options;
    Options.bOverride_TextShapingMethod = true;
    Options.TextShapingMethod = ETextShapingMethod::FullShaping;
    Options.bOverride_TextFlowDirection = true;
    Options.TextFlowDirection = ETextFlowDirection::Auto;
    SetShapedTextOptions(Options);
}
UMansouraOverlay::UMansouraOverlay(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer)
{
    SetIsFocusable(false);
}
TSharedRef<SWidget> UMansouraOverlay::RebuildWidget()
{
    if (!WidgetTree) WidgetTree = NewObject<UWidgetTree>(this, TEXT("MansouraWidgetTree"));
    if (!WidgetTree->RootWidget)
    {
        auto* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(),TEXT("TransparentHUDRoot")); WidgetTree->RootWidget = Canvas;
        Canvas->SetVisibility(ESlateVisibility::HitTestInvisible);
        const auto AddText = [&](const TCHAR* Name,int32 Size,FVector2D Anchor,FVector2D Position,FVector2D Dimensions,FVector2D Alignment,ETextJustify::Type Justify)
        {
            auto* Text = WidgetTree->ConstructWidget<UMansouraShapedText>(UMansouraShapedText::StaticClass(),FName(Name));
            Text->SetFont(FCoreStyle::GetDefaultFontStyle(TEXT("Regular"),Size));Text->SetColorAndOpacity(FSlateColor(FLinearColor(.96f,.94f,.87f)));
            Text->SetShadowColorAndOpacity(FLinearColor(0.f,0.f,0.f,.9f));Text->SetShadowOffset(FVector2D(1.5,1.5));
            Text->SetJustification(Justify);Text->SetAutoWrapText(true);Text->SetVisibility(ESlateVisibility::HitTestInvisible);
            auto* Slot=Canvas->AddChildToCanvas(Text);Slot->SetAnchors(FAnchors(Anchor.X,Anchor.Y));Slot->SetAlignment(Alignment);Slot->SetPosition(Position);Slot->SetSize(Dimensions);
            return Text;
        };
        Telemetry=AddText(TEXT("CornerTelemetry"),22,{0.,0.},{22.,20.},{360.,76.},{0.,0.},ETextJustify::Left);
        Journey=AddText(TEXT("CornerJourney"),16,{1.,0.},{-22.,22.},{470.,176.},{1.,0.},ETextJustify::Right);
        Caption=AddText(TEXT("EgyptianCaption"),20,{.5,1.},{0.,-76.},{940.,76.},{.5,1.},ETextJustify::Center);
        Attribution=AddText(TEXT("OSMAttribution"),11,{0.,1.},{18.,-14.},{580.,19.},{0.,1.},ETextJustify::Left);
        Controls=AddText(TEXT("CornerControls"),12,{1.,1.},{-18.,-14.},{590.,43.},{1.,1.},ETextJustify::Right);
        Attribution->SetText(FText::FromString(TEXT("Map: OpenStreetMap contributors | ODbL 1.0 | openstreetmap.org/copyright")));
        Controls->SetText(FText::FromString(TEXT("WASD drive · Ctrl brake · Space handbrake · H horn\nF ask · 1 agree · 3 refuse · 4 share · E board/exit · M places · R recover · Tab HUD · Esc pause")));
    }
    return Super::RebuildWidget();
}
void UMansouraOverlay::NativeTick(const FGeometry& MyGeometry,float InDeltaTime)
{
    Super::NativeTick(MyGeometry,InDeltaTime);RefreshSeconds-=InDeltaTime;if(RefreshSeconds>0.f)return;RefreshSeconds=.1f;
    RefreshHUD();
}
void UMansouraOverlay::RefreshHUD()
{
    if (auto* Game=GetWorld()?GetWorld()->GetAuthGameMode<AMansouraGameMode>():nullptr)
    {
        if(Telemetry)Telemetry->SetText(Game->GetTelemetryText());
        if(Journey)Journey->SetText(Game->GetJourneyText());
        if(Caption)Caption->SetText(Game->GetCaptionText());
    }
}
