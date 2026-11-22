// Dialogue lines print as "NAME: text" and carry #speaker; narration has no speaker tag. An extension and a parenthetical are tags too.
Rain on the glass.
MIRA: Are you coming? #speaker:mira
OLD MAN (V.O.): Not tonight. #speaker:old_man #ext:V.O. #paren:quietly
+ [Follow her]
    Mira is already gone.
    -> END
+ [Stay]
    The room is quiet.
    -> END
