using System;
using System.IO;
using UnityEngine;

namespace __NAMESPACE__
{
    /// <summary>
    /// Where save slots are kept. Implement it on a MonoBehaviour and set the controller's Save Storage to use your
    /// game's own saves (Steam Cloud, a console's save data, your save file); keys are short names like "slot-1".
    /// </summary>
    public interface ISaveStorage
    {
        void Write(string key, string data);
        /// <summary>The data saved under key, or null.</summary>
        string Read(string key);
        void Delete(string key);
    }

    /// <summary>The default: one small JSON file per slot in Application.persistentDataPath/NarrativeBridge/&lt;story&gt;/.</summary>
    public class FileSaveStorage : ISaveStorage
    {
        public readonly string Folder;

        public FileSaveStorage(string folder = null)
        {
            Folder = folder ?? System.IO.Path.Combine(Application.persistentDataPath, "NarrativeBridge", StoryInfo.PackageName);
        }

        string FileFor(string key) => System.IO.Path.Combine(Folder, key + ".json");

        public void Write(string key, string data)
        {
            Directory.CreateDirectory(Folder);
            // Write a new file and swap it in, so a crash mid-save never leaves half a save.
            var file = FileFor(key);
            var temp = file + ".tmp";
            File.WriteAllText(temp, data);
            if (File.Exists(file)) File.Delete(file);
            File.Move(temp, file);
        }

        public string Read(string key)
        {
            var file = FileFor(key);
            return File.Exists(file) ? File.ReadAllText(file) : null;
        }

        public void Delete(string key)
        {
            var file = FileFor(key);
            if (File.Exists(file)) File.Delete(file);
        }
    }
}
