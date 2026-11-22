// A gated choice is offered only when its condition holds; a once-only (*) choice disappears after it is taken.
VAR has_key = false
-> hall
=== hall ===
A locked door.
* [Search the room]
    ~ has_key = true
    -> hall
+ {has_key} [Open the door]
    -> END
+ [Leave]
    -> END
