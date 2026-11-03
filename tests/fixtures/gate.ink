VAR has_lamp = false
VAR courage = 0

The night is cold. You stand at the gate.
-> gate

=== gate ===
MARA: Are you coming in?
* [Light the lamp] 
    ~ has_lamp = true
    -> gate
+ {has_lamp} [Go inside] -> hall
+ {courage >= 2 && not has_lamp} [Run in blind] -> hall
+ [Wait] 
    ~ courage += 1
    -> gate

=== hall ===
The hall is silent. // writer's note: add footsteps
-> END
