// Create context menu items when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  // Create the context menu item for blocking usernames
  chrome.contextMenus.create({
    id: "blockUsername",
    title: "Hide this user",
    contexts: ["link"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
  });
});

// Handle context menu clicks
function extractUsernameFromUrl(url) {
  try {
    // First try using URL API
    const parsedUrl = new URL(url);

    // Check if it's a Twitter/X domain
    if (
      !parsedUrl.hostname.includes("twitter.com") &&
      !parsedUrl.hostname.includes("x.com")
    ) {
      return null;
    }

    // Get the pathname and remove leading slash
    const path = parsedUrl.pathname.replace(/^\/+/, "");

    // Split the path and get the first segment (username)
    const pathSegments = path.split("/");

    // Ensure it's not an internal Twitter route
    const reservedRoutes = [
      "home",
      "explore",
      "notifications",
      "messages",
      "i",
      "settings",
    ];
    if (pathSegments.length > 0 && !reservedRoutes.includes(pathSegments[0])) {
      return pathSegments[0].toLowerCase();
    }

    return null;
  } catch (e) {
    // Fallback to regex extraction if URL parsing fails
    const twitterRegex =
      /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([^\/\?\s]+)/i;
    const match = url.match(twitterRegex);

    if (match && match[1]) {
      // Ensure it's not an internal Twitter route
      const reservedRoutes = [
        "home",
        "explore",
        "notifications",
        "messages",
        "i",
        "settings",
      ];
      if (!reservedRoutes.includes(match[1].toLowerCase())) {
        return match[1].toLowerCase();
      }
    }

    return null;
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "blockUsername") {
    const url = info.linkUrl;
    const username = extractUsernameFromUrl(url);

    if (username) {
      chrome.storage.sync.get(
        ["blockedUsers", "enableUserBlocking"],
        (result) => {
          const currentBlocked = result.blockedUsers || [];

          // Check if already blocked
          if (!currentBlocked.includes(username)) {
            const newBlockedUsers = [...currentBlocked, username];

            // Save updated list to storage
            chrome.storage.sync.set(
              {
                blockedUsers: newBlockedUsers,
                enableUserBlocking: true,
              },
              () => {
                // Show notification to user
                chrome.tabs.sendMessage(tab.id, {
                  action: "userBlocked",
                  username: username,
                });
              },
            );
          }
        },
      );
    }
  }
});
