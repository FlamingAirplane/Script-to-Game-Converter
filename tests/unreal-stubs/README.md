# Stand-in Unreal and Inkpot headers

Just enough of Unreal Engine's and Inkpot's headers for `npm run test:unreal` to check that the C++ in the
Unreal export is valid C++ (`clang++ -fsyntax-only`), so a typo or a wrong type in the generated code fails CI.

They are not the real headers. Passing this check doesn't mean the project builds in Unreal: the macros
(`UCLASS`, `UFUNCTION`…) do nothing here, and the Inkpot classes only have the members the generated code
uses, written to match Inkpot's API. When the generated code starts using something new from Unreal or
Inkpot, add it here with the same signature as the real header.
