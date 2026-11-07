#pragma once
struct UInkpotChoice;
class UInkpotStory { public: bool CanContinue() { return false; } FString Continue() { return FString(); } TArray<FString> GetCurrentTags() { return {}; } TArray<UInkpotChoice*> GetCurrentChoices() { return {}; } void ChooseChoiceIndex(int32) {} void SetBool(const FString&, bool) {} };
