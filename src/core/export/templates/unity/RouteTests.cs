using System.Collections.Generic;
using NUnit.Framework;
using __NAMESPACE__.EditorTools;

namespace __NAMESPACE__.Tests
{
    /// <summary>
    /// The story's playthrough routes as Test Runner tests (Window → General → Test Runner → Edit Mode). Each one
    /// replays a route through NarrativeController and checks the story still plays as it did when exported.
    /// A package's tests show in the Test Runner when the project lists it under "testables" in Packages/manifest.json.
    /// </summary>
    public class PlaythroughTests
    {
        static IEnumerable<TestCaseData> Routes()
        {
            for (int i = 0; i < StoryRoutes.All.Length; i++)
                yield return new TestCaseData(i).SetName("Route " + (i + 1).ToString("00") + " - " + StoryRoutes.All[i].Name.Replace("(", "[").Replace(")", "]").Replace(",", " "));
        }

        [TestCaseSource(nameof(Routes))]
        public void PlaysAsWritten(int route)
        {
            var problem = PlaythroughRunner.Run(StoryRoutes.All[route]);
            Assert.IsNull(problem, problem);
        }

        [Test]
        public void HasRoutes() => Assert.Greater(StoryRoutes.All.Length, 0, "The export found no playthrough routes.");
    }
}
