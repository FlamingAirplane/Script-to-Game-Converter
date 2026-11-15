using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using __NAMESPACE__;

/// <summary>
/// Makes your game's inventory the one source of truth for the story's items. Replace the HashSet with
/// calls into your own inventory system, then drag this component onto the NarrativeController's
/// "Inventory Authority" field. Item ids are listed in StoryInfo.ItemVariables (without "has_").
/// </summary>
public class StoryInventoryBridge : MonoBehaviour, IInventoryAuthority
{
    [System.Serializable] public class ItemEvent : UnityEvent<string> { }

    public List<string> startingItems = new List<string>();
    public ItemEvent itemGiven = new ItemEvent();
    public ItemEvent itemTaken = new ItemEvent();

    readonly HashSet<string> items = new HashSet<string>();

    void Awake() { foreach (var i in startingItems) items.Add(i); }

    public bool HasItem(string itemId) => items.Contains(itemId);

    public void GiveItem(string itemId)
    {
        if (items.Add(itemId)) itemGiven.Invoke(itemId);
    }

    public void TakeItem(string itemId)
    {
        if (items.Remove(itemId)) itemTaken.Invoke(itemId);
    }
}
