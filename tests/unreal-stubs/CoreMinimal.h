#pragma once
#include <cstdint>
#include <string>
#include <vector>
#define TEXT(x) L##x
typedef wchar_t TCHAR; typedef int32_t int32;
#define INDEX_NONE (-1)
namespace ESearchCase { enum Type { CaseSensitive, IgnoreCase }; }
struct FString {
  std::wstring s;
  FString() {} FString(const TCHAR* c) : s(c) {} FString(std::wstring w) : s(w) {}
  FString TrimStartAndEnd() const { return *this; }
  bool IsEmpty() const { return s.empty(); }
  bool Split(const FString&, FString*, FString*) const { return false; }
  bool StartsWith(const FString&) const { return false; }
  FString Mid(int32) const { return *this; }
  FString Left(int32) const { return *this; }
  int32 Len() const { return (int32)s.size(); }
  bool FindChar(TCHAR, int32&) const { return false; }
  int32 ReplaceInline(const TCHAR*, const TCHAR*, ESearchCase::Type = ESearchCase::IgnoreCase) { return 0; }
  bool operator==(const TCHAR* o) const { return s == o; }
  FString operator+(const FString& o) const { return s + o.s; }
  operator const TCHAR*() const { return s.c_str(); }
};
template <class T> struct TArray { std::vector<T> v; int32 Num() const { return (int32)v.size(); } void Add(const T& x) { v.push_back(x); } T& operator[](int32 i) { return v[i]; } const T& operator[](int32 i) const { return v[i]; } auto begin() const { return v.begin(); } auto end() const { return v.end(); } };
template <class T> using TObjectPtr = T*;
#define UCLASS(...)
#define GENERATED_BODY()
#define UPROPERTY(...)
#define UFUNCTION(...)
#define UE_LOG(...)
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE(N) struct N { void Broadcast() {} };
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(N, T1, P1) struct N { void Broadcast(T1) {} };
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(N, T1, P1, T2, P2) struct N { void Broadcast(T1, T2) {} };
#define DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(N, T1, P1, T2, P2, T3, P3) struct N { void Broadcast(T1, T2, T3) {} };
