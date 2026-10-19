#include "MansouraGameMode.h"

#include "MansouraCity.h"
#include "MansouraController.h"
#include "MansouraTaxiPawn.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

DEFINE_LOG_CATEGORY_STATIC(LogMansouraShift, Log, All);

AMansouraGameMode::AMansouraGameMode()
{
    DefaultPawnClass = AMansouraTaxiPawn::StaticClass();
    PlayerControllerClass = AMansouraController::StaticClass();
    HUDClass = nullptr;
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = .05f;
}

void AMansouraGameMode::StartPlay()
{
    // BeginPlay of a newly spawned City loads its data synchronously. Do not
    // invoke LoadCity a second time or duplicate an actor already in the map.
    Super::StartPlay();
    for (TActorIterator<AMansouraCity> It(GetWorld()); It; ++It) { City = *It; break; }
    if (!City)
    {
        FActorSpawnParameters Parameters; Parameters.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        City = GetWorld()->SpawnActor<AMansouraCity>(AMansouraCity::StaticClass(), FTransform::Identity, Parameters);
    }
    if (!City || !City->IsCityLoaded())
    {
        Say(TEXT("City data could not be loaded."), TEXT("Check Content/Data and the native build log."), 120.);
        UE_LOG(LogMansouraShift, Error, TEXT("Native shift cannot start without the attributed city dataset."));
        return;
    }

    // Prefer individually verified destinations for manual cycling; a legacy
    // mapped stop remains usable as a fare destination without a verified label.
    for (int32 I = 0; I < City->Destinations.Num(); ++I)
    {
        const auto& Destination = City->Destinations[I];
        if (Destination.bReachable && Destination.LocationStatus.Contains(TEXT("verified"), ESearchCase::IgnoreCase)
            && !Destination.LocationStatus.Contains(TEXT("unverified"), ESearchCase::IgnoreCase)) SelectableDestinations.Add(I);
    }
    if (SelectableDestinations.IsEmpty())
        for (int32 I = 0; I < City->Destinations.Num(); ++I) if (City->Destinations[I].bReachable) SelectableDestinations.Add(I);

    APlayerController* Controller = UGameplayStatics::GetPlayerController(this, 0);
    if (Controller && !Taxi())
    {
        FActorSpawnParameters Parameters; Parameters.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        if (auto* Pawn = GetWorld()->SpawnActor<AMansouraTaxiPawn>(AMansouraTaxiPawn::StaticClass(), City->GetTaxiStart(), Parameters)) Controller->Possess(Pawn);
    }
    if (auto* Pawn = Taxi())
    {
        const FTransform Start = City->GetTaxiStart();
        Pawn->ResetVehicleAt(Start.GetLocation(), Start.Rotator());
        PreviousTaxiPosition = Start.GetLocation(); bHavePreviousPosition = true;
        if (Controller) Controller->SetViewTarget(Pawn);
    }
    if (!SelectableDestinations.IsEmpty()) SelectedDestinationId = City->Destinations[SelectableDestinations[0]].Id;
    RefreshDestinationMarker();
    Say(TEXT("يلا بينا على المشاية. الشغل رزق... والركنة نص الشغل."), TEXT("F زبون جديد  |  M الوجهة  |  E ركوب ونزول وأنت واقف"), 12.);
    UE_LOG(LogMansouraShift, Display, TEXT("Native four-rider prototype ready. Fare amounts are fictional game currency. Destination distances are straight-line, not computed road routes."));
}

AMansouraTaxiPawn* AMansouraGameMode::Taxi() const { return Cast<AMansouraTaxiPawn>(UGameplayStatics::GetPlayerPawn(this, 0)); }
bool AMansouraGameMode::IsStopped() const { const auto* Pawn = Taxi(); return Pawn && FMath::Abs(Pawn->GetSpeedKmh()) < 3.f; }
bool AMansouraGameMode::ResolveAccess(const FString& Id, FTransform& Access) const { return City && City->GetDestinationAccess(Id, Access); }
void AMansouraGameMode::Say(const FString& One, const FString& Two, double Seconds)
{
    CaptionLineOne = One; CaptionLineTwo = Two; CaptionSecondsLeft = Seconds;
}

void AMansouraGameMode::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (CaptionSecondsLeft > 0.) CaptionSecondsLeft = FMath::Max(0., CaptionSecondsLeft - DeltaSeconds);
    if (AMansouraTaxiPawn* Pawn = Taxi())
    {
        const FVector Position = Pawn->GetActorLocation();
        if (bHavePreviousPosition)
        {
            const double Step = FVector::Dist2D(Position, PreviousTaxiPosition);
            if (Step < 2000.) OdometerMetres += Step / 100.; // Exclude recovery/streaming teleports.
        }
        PreviousTaxiPosition = Position; bHavePreviousPosition = true;
        if (City && City->IsCityLoaded() && Position.Z < -1800.) ResetTaxiSafely();
        if (Pending.bActive)
        {
            Pending.SecondsLeft -= DeltaSeconds;
            if (Pending.SecondsLeft <= 0. || FVector::Dist2D(Position, Pending.Pickup) > 16000.)
            {
                Pending = FRequest();
                Say(TEXT("الزبون: خلاص يا أسطى، لحقت مواصلة تانية."), TEXT("F اسأل زبون جديد لما تقف بأمان."));
            }
        }
    }
}

void AMansouraGameMode::AskForFare()
{
    if (!City || !City->IsCityLoaded() || !Taxi()) return;
    if (Riders.Num() >= 4) { Say(TEXT("أربعة كفاية... دي فيرنا مش ميكروباص."), TEXT("وصل حد من الركاب الأول.")); return; }
    if (!IsStopped()) { Say(TEXT("على مهلك يا أسطى، نتكلم وإحنا واقفين."), TEXT("قف بأمان ثم F للاتفاق على المشوار.")); return; }
    if (Pending.bActive) { Say(TEXT("الزبون مستني ردك يا أسطى."), Pending.bAgreed ? TEXT("E للركوب عند نقطة الاتفاق.") : TEXT("1 قبول  |  3 اعتذار  |  4 اتفاق على المشاركة")); return; }
    const FVector Position = Taxi()->GetActorLocation();
    TArray<int32> Choices;
    for (int32 I = 0; I < City->Destinations.Num(); ++I)
    {
        const auto& Destination = City->Destinations[I];
        if (Destination.bReachable && FVector::Dist2D(Position, Destination.RoadAccess.GetLocation()) > 22000.) Choices.Add(I);
    }
    if (Choices.IsEmpty()) { Say(TEXT("مفيش مشوار بعيد متاح من النقطة دي دلوقتي."), TEXT("M اختار وجهة تانية واتحرك شوية.")); return; }
    FTransform Pickup;
    if (!City->FindNearestRoadPose(Position, Pickup, 6000.) || FVector::Dist2D(Position, Pickup.GetLocation()) > 1800.)
    { Say(TEXT("نطلع على طريق واضح الأول يا أسطى."), TEXT("الركوب متاح جنب طريق مرسوم وبعيد عن المداخل.")); return; }
    const auto& Destination = City->Destinations[Choices[FareRandom.RandRange(0, Choices.Num() - 1)]];
    const TCHAR* Names[] = {TEXT("أم محمود"),TEXT("عم سيد"),TEXT("مريم"),TEXT("أحمد"),TEXT("أستاذة هدى"),TEXT("عم رضا")};
    Pending = FRequest(); Pending.bActive = true; Pending.RiderId = NextRiderId++;
    Pending.Name = Names[FareRandom.RandRange(0, UE_ARRAY_COUNT(Names) - 1)]; Pending.DestinationId = Destination.Id;
    Pending.DestinationName = Destination.Arabic.IsEmpty() ? Destination.Name : Destination.Arabic;
    Pending.Pickup = Pickup.GetLocation(); Pending.SecondsLeft = 45.;
    const double DirectKilometres = FVector::Dist2D(Pending.Pickup, Destination.RoadAccess.GetLocation()) / 100000.;
    Pending.Fare = FMath::Max(15, FMath::RoundToInt((15. + DirectKilometres * 12.) / 5.) * 5);
    Say(FString::Printf(TEXT("%s: على %s... معايا %d جنيه."), *Pending.Name, *Pending.DestinationName, Pending.Fare),
        Riders.IsEmpty() ? TEXT("1 قبول  |  3 اعتذار  |  4 نتفق على المشاركة") : TEXT("في ركاب معاك؛ 4 وضّح المشاركة الأول، وبعدها 1 قبول."), 45.);
}

void AMansouraGameMode::AcceptFare()
{
    if (!Pending.bActive) { Say(TEXT("نتفق مع زبون الأول."), TEXT("F وأنت واقف لطلب مشوار.")); return; }
    if (!IsStopped()) { Say(TEXT("الاتفاق وإحنا واقفين يا أسطى."), TEXT("اهدأ واقف في مكان آمن.")); return; }
    if (Riders.Num() >= 4) { Say(TEXT("العربية كاملة يا أسطى."), TEXT("كل راكب له مكانه ومشواره.")); return; }
    if (!Riders.IsEmpty() && !Pending.bSharingDiscussed)
    { Say(TEXT("الزبون: طب هو المشوار لوحدي ولا معايا ناس؟"), TEXT("4 للاتفاق على المشاركة مع الكل، ثم 1 للقبول.")); return; }
    Pending.bAgreed = true; Pending.SecondsLeft = 65.;
    Say(FString::Printf(TEXT("اتفقنا يا %s: %d جنيه لحد %s."), *Pending.Name, Pending.Fare, *Pending.DestinationName), TEXT("E يركب لما تكون واقف عند نقطة الاتفاق."), 15.);
}

void AMansouraGameMode::RefuseFare()
{
    if (!Pending.bActive) return;
    Pending = FRequest(); Say(TEXT("ولا يهمك، ربنا يسهّل طريقك."), TEXT("F لزبون تاني؛ الركاب اللي معاك اتفاقهم زي ما هو."));
}

void AMansouraGameMode::DiscussSharing()
{
    if (!Pending.bActive) { Say(TEXT("المشاركة اتفاق... مش مفاجأة في نص الطريق."), TEXT("F يجيب مشوار، وبعدها 4 نتكلم على المشاركة.")); return; }
    if (!IsStopped()) { Say(TEXT("نتفق على المشاركة وإحنا واقفين."), TEXT("الطريق محتاج عينيك قبل الكلام.")); return; }
    // Minimal native conversation: the displayed answer explicitly represents
    // consent from both the waiting rider and existing riders. No silent add-on.
    Pending.bSharingDiscussed = true;
    for (auto& Rider : Riders) Rider.bSharingAccepted = true;
    Say(TEXT("السواق: مشاركة بموافقة الكل، وكل واحد أجرته واتفاقه لوحده."), TEXT("الركاب: موافقين. 1 تأكيد الأجرة، وبعدها E للركوب."), 18.);
}

void AMansouraGameMode::BoardOrDropOff()
{
    const auto* Pawn = Taxi(); if (!Pawn || !City) return;
    if (!IsStopped()) { Say(TEXT("استنى لما نقف يا أسطى... النزلة مش قفزة ثقة."), TEXT("E للركوب والنزول تحت 3 كم/س.")); return; }
    int32 Paid = 0, Dropped = 0;
    for (int32 I = Riders.Num() - 1; I >= 0; --I)
    {
        FTransform Access;
        if (ResolveAccess(Riders[I].DestinationId, Access) && FVector::Dist2D(Pawn->GetActorLocation(), Access.GetLocation()) <= 2800.)
        {
            Paid += Riders[I].AgreedFare; ++Dropped; ++CompletedFares;
            Riders.RemoveAt(I); // Removes the agreement before another E can pay it again.
        }
    }
    if (Dropped > 0)
    {
        ShiftIncome += Paid; SelectNextOnboardDestination();
        Say(FString::Printf(TEXT("وصلنا بالسلامة. %d راكب نزلوا، الحساب %d جنيه."), Dropped, Paid), TEXT("كل مشوار اتحاسب مرة واحدة بأجرته المتفق عليها."), 12.);
    }
    if (Pending.bActive && Pending.bAgreed)
    {
        if (Riders.Num() >= 4) { Say(TEXT("مفيش كرسي فاضي يا أسطى."), TEXT("الحد الأقصى أربعة ركاب.")); return; }
        if (FVector::Dist2D(Pawn->GetActorLocation(), Pending.Pickup) > 2200.)
        { Say(TEXT("الزبون لسه عند نقطة الاتفاق."), TEXT("ارجع لنقطة الوقفة الأول؛ الاتفاق لسه محفوظ.")); return; }
        if (!Riders.IsEmpty() && !Pending.bSharingDiscussed)
        { Say(TEXT("المشاركة محتاجة اتفاق واضح."), TEXT("4 قبل ما تركّب حد مع الركاب.")); return; }
        FMansouraRiderAgreement Rider; Rider.Id = Pending.RiderId; Rider.Name = Pending.Name;
        Rider.DestinationId = Pending.DestinationId; Rider.DestinationName = Pending.DestinationName;
        Rider.AgreedFare = Pending.Fare; Rider.bSharingAccepted = Pending.bSharingDiscussed; Rider.BoardedAtMetres = OdometerMetres;
        const bool bFirst = Riders.IsEmpty(); Riders.Add(MoveTemp(Rider));
        if (bFirst) SelectedDestinationId = Pending.DestinationId;
        const FString Name = Pending.Name; Pending = FRequest(); RefreshDestinationMarker();
        Say(Name + TEXT(": يلا بينا، والشارع علينا كلنا."), FString::Printf(TEXT("%d / 4 ركاب  |  الأجرة والوجهة محفوظين لكل راكب."), Riders.Num()), 12.);
        return;
    }
    if (Dropped == 0) Say(TEXT("ننزل عند النزلة المتفق عليها يا أسطى."), Pending.bActive ? TEXT("1 للاتفاق على الأجرة قبل الركوب.") : TEXT("M للوجهة  |  F لزبون جديد وأنت واقف."));
}

void AMansouraGameMode::CycleDestination()
{
    if (!City || SelectableDestinations.IsEmpty()) return;
    int32 Current = INDEX_NONE;
    for (int32 I = 0; I < SelectableDestinations.Num(); ++I)
        if (City->Destinations[SelectableDestinations[I]].Id == SelectedDestinationId) { Current = I; break; }
    const auto& Next = City->Destinations[SelectableDestinations[(Current + 1) % SelectableDestinations.Num()]];
    SelectedDestinationId = Next.Id; RefreshDestinationMarker();
    Say(Next.Arabic.IsEmpty() ? Next.Name : Next.Arabic, TEXT("المسافة المعروضة مباشرة؛ علامة صغيرة عند نقطة الطريق."), 6.);
}

void AMansouraGameMode::SelectNextOnboardDestination()
{
    if (!Riders.IsEmpty()) SelectedDestinationId = Riders[0].DestinationId;
    RefreshDestinationMarker();
}
void AMansouraGameMode::ResetTaxiSafely()
{
    auto* Pawn = Taxi(); if (!Pawn || !City || !City->IsCityLoaded()) return;
    FTransform Pose;
    if (!City->FindNearestRoadPose(Pawn->GetActorLocation(), Pose, 12000.)) Pose = City->GetTaxiStart();
    Pawn->ResetVehicleAt(Pose.GetLocation(), Pose.Rotator()); PreviousTaxiPosition = Pose.GetLocation(); bHavePreviousPosition = true;
    Say(TEXT("رجعنا للطريق بأمان. المشاوير والاتفاقات زي ما هي."), TEXT("العداد والمسافة ما اتصفّروش."), 8.);
}

void AMansouraGameMode::RefreshDestinationMarker()
{
    if (!GetWorld()) return;
    FTransform Access;
    if (!ResolveAccess(SelectedDestinationId, Access)) { if (DestinationMarker) DestinationMarker->SetActorHiddenInGame(true); return; }
    if (!DestinationMarker)
    {
        DestinationMarker = GetWorld()->SpawnActor<AActor>();
        if (!DestinationMarker) return;
        auto* Root = NewObject<USceneComponent>(DestinationMarker, TEXT("MarkerRoot")); DestinationMarker->SetRootComponent(Root); Root->RegisterComponent();
        auto* Dot = NewObject<UStaticMeshComponent>(DestinationMarker, TEXT("SmallRoadStopDot")); Dot->SetupAttachment(Root);
        Dot->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"))); Dot->SetRelativeScale3D(FVector(.3f));
        Dot->SetRelativeLocation(FVector(0., 0., 170.)); Dot->SetCollisionEnabled(ECollisionEnabled::NoCollision); Dot->SetCastShadow(false);
        if (auto* Parent = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Mansoura/Materials/M_Prototype.M_Prototype")))
        {
            auto* Material = UMaterialInstanceDynamic::Create(Parent, this); Material->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.f,.65f,.16f));
            Material->SetVectorParameterValue(TEXT("Emissive"), FLinearColor(.8f,.32f,.04f)); Dot->SetMaterial(0,Material);
        }
        Dot->RegisterComponent(); DestinationMarker->Tags.Add(FName(TEXT("SmallDestinationMarker")));
    }
    DestinationMarker->SetActorLocation(Access.GetLocation() - FVector(0.,0.,126.)); DestinationMarker->SetActorHiddenInGame(false);
}

FText AMansouraGameMode::GetTelemetryText() const
{
    const auto* Pawn = Taxi();
    return FText::FromString(FString::Printf(TEXT("%03.0f km/h    %s%d\n%.1f km    EGP %d    %d / 4 riders"),
        Pawn ? FMath::Abs(Pawn->GetSpeedKmh()) : 0.f, Pawn && Pawn->CurrentGear < 0 ? TEXT("R") : TEXT("D"),
        Pawn ? FMath::Max(1,Pawn->CurrentGear) : 1, OdometerMetres/1000.,ShiftIncome,Riders.Num()));
}
FText AMansouraGameMode::GetJourneyText() const
{
    FString Text; const auto* Pawn = Taxi();
    if (City) for (const auto& Destination : City->Destinations) if (Destination.Id == SelectedDestinationId)
    {
        Text = Destination.Arabic.IsEmpty() ? Destination.Name : Destination.Arabic;
        if (Pawn) Text += FString::Printf(TEXT("  |  %.0f m مباشر"), FVector::Dist2D(Pawn->GetActorLocation(),Destination.RoadAccess.GetLocation())/100.);
        break;
    }
    for (const auto& Rider : Riders) Text += FString::Printf(TEXT("\n%s: %s · %d ج"),*Rider.Name,*Rider.DestinationName,Rider.AgreedFare);
    return FText::FromString(Text);
}
FText AMansouraGameMode::GetCaptionText() const
{
    if (UGameplayStatics::IsGamePaused(this)) return FText::FromString(TEXT("وقفة صغيرة... العربية والمشاوير مستنيينك.\nEsc نكمل  |  Tab إخفاء المعلومات"));
    if (CaptionSecondsLeft <= 0.) return FText::GetEmpty();
    return FText::FromString(CaptionLineOne + TEXT("\n") + CaptionLineTwo);
}
