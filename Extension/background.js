// background.js
// Create context menu items when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Create the context menu item for blocking usernames
  chrome.contextMenus.create({
    id: "blockUsername",
    title: "Hide this user",
    contexts: ["link"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "blockUsername") {
    // Extract username from the link URL
    let username = null;
    
    // Check if it's a profile link
    const url = info.linkUrl;
    if (url && (url.includes("twitter.com/") || url.includes("x.com/"))) {
      // Parse the URL to extract username
      const urlParts = url.split('/');
      // Find the part after domain
      for (let i = 0; i < urlParts.length; i++) {
        if ((urlParts[i] === "twitter.com" || urlParts[i] === "x.com") && i + 1 < urlParts.length) {
          username = urlParts[i + 1].split('?')[0]; // Remove any query parameters
          break;
        }
      }
      
      if (username) {
        // Update blockedUsers list in storage
        chrome.storage.sync.get(['blockedUsers', 'enableUserBlocking'], (result) => {
          const currentBlocked = result.blockedUsers || [];
          
          // Check if already blocked
          if (!currentBlocked.includes(username)) {
            const newBlockedUsers = [...currentBlocked, username];
            
            // Save updated list to storage
            chrome.storage.sync.set({
              blockedUsers: newBlockedUsers,
              enableUserBlocking: true // Also enable user blocking
            }, () => {
              // Show notification to user
              chrome.tabs.sendMessage(tab.id, { 
                action: "userBlocked", 
                username: username 
              });
            });
          }
        });
      }
    }
  }
});