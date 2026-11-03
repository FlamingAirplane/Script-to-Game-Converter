INCLUDE extras.ink
VAR mood = "calm"
-> start
=== start ===
Hello {player_name}! The weather is {~sunny|rainy|grim}.
* Hello back [] said you.
    You wave. <> Cheerfully.
- They nod.
-> chat ->
{ start > 1: You've been here before. }
+ [Leave] -> END
=== chat ===
~ temp x = RANDOM(1, 6)
Chatting.
->->
=== function greet(name)
~ return "Hi " + name
