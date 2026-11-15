namespace __NAMESPACE__
{
    /// <summary>
    /// Implement on a MonoBehaviour to make your game the authority for item possession.
    /// The story only requests changes; the game decides and the controller mirrors the result into Ink.
    /// Item ids are StoryInfo.ItemVariables without the "has_" prefix.
    /// </summary>
    public interface IInventoryAuthority
    {
        bool HasItem(string itemId);
        void GiveItem(string itemId);
        void TakeItem(string itemId);
    }
}
