using UnityEditor;

namespace NarrativeBridgeProject
{
    [InitializeOnLoad]
    static class OpenDemoOnFirstOpen
    {
        static OpenDemoOnFirstOpen()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                var editor = System.Type.GetType("__NAMESPACE__.EditorTools.NarrativeBridgeEditor, __NAMESPACE__.Editor");
                var create = editor != null ? editor.GetMethod("CreateDemoSceneIfMissing") : null;
                if (create != null) create.Invoke(null, null);
            };
        }
    }
}
