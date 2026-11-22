using System;
using System.Collections.Generic;

namespace __NAMESPACE__
{
    /// <summary>
    /// A choice that needs an item or a value, as approved in Pen to Ink (StoryInfo.GatedChoices). Ink hides
    /// such a choice while its condition fails; NarrativeController.LockedChoices lists the ones locked right now,
    /// with what they need in plain words, so the story panel (or your UI) can show them greyed out.
    /// </summary>
    public sealed class GatedChoice
    {
        /// <summary>The passage (ink knot) the choice is in.</summary>
        public readonly string Passage;
        /// <summary>The choice's text, as the story shows it.</summary>
        public readonly string Text;
        readonly Requirement[] requirements;

        public GatedChoice(string passage, string text, params Requirement[] requirements)
        {
            Passage = passage;
            Text = text;
            this.requirements = requirements ?? new Requirement[0];
        }

        /// <summary>What the choice needs that the reader doesn't have, in plain words (empty when it's open).</summary>
        public string[] Missing(Func<string, object> read)
        {
            var list = new List<string>();
            foreach (var r in requirements) if (!r.Test(read)) list.Add(r.Words);
            return list.ToArray();
        }

        /// <summary>One condition: in plain words ("Brass Key", "trust at least 2") and as a test of the story's variables.</summary>
        public sealed class Requirement
        {
            public readonly string Words;
            public readonly Func<Func<string, object>, bool> Test;
            public Requirement(string words, Func<Func<string, object>, bool> test)
            {
                Words = words;
                Test = test;
            }
        }

        /// <summary>Whether an ink value is true (items are ink Booleans named has_&lt;item&gt;).</summary>
        public static bool Has(object v)
        {
            if (v is bool b) return b;
            if (v is int i) return i != 0;
            if (v is float f) return f != 0f;
            return false;
        }

        /// <summary>Compares an ink value the way ink does: numbers as numbers, text and true/false as they are.</summary>
        public static bool Compare(object a, string op, object b)
        {
            if (IsNumber(a) && IsNumber(b))
            {
                var x = Convert.ToDouble(a);
                var y = Convert.ToDouble(b);
                switch (op)
                {
                    case "==": return x == y;
                    case "!=": return x != y;
                    case "<": return x < y;
                    case "<=": return x <= y;
                    case ">": return x > y;
                    case ">=": return x >= y;
                }
                return false;
            }
            var same = Equals(a, b) || (a is bool ab && IsNumber(b) && ab == (Convert.ToDouble(b) != 0));
            if (op == "==") return same;
            if (op == "!=") return !same;
            if (a is string sa && b is string sb)
            {
                var c = string.CompareOrdinal(sa, sb);
                switch (op)
                {
                    case "<": return c < 0;
                    case "<=": return c <= 0;
                    case ">": return c > 0;
                    case ">=": return c >= 0;
                }
            }
            return false;
        }

        static bool IsNumber(object v) => v is int || v is float || v is double || v is long;
    }
}
