let generalBlockedWords = [];
let notificationTimeout;
let linkBlockedWords = [];
let blockedUsers = [];
let enableUserBlocking = false;
let debugMode = false;
let hiddenTweetCount = 0;
let autoCollectUsers = true;
let collectedUsers = []; // Track users we've found

function debugLog(...args) {
  if (debugMode) {
    console.log("[Twitter Word Blocker]", ...args);
  }
}

function isTwitterDomain(url) {
  return (
    url.includes("twitter.com") || url.includes("x.com") || url.startsWith("/")
  );
}

function updateCounterDisplay() {
  let counterEl = document.getElementById("tweet-blocker-counter");

  if (!counterEl) {
    counterEl = document.createElement("div");
    counterEl.id = "tweet-blocker-counter";
    counterEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: rgba(29, 155, 240, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      z-index: 9999;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(counterEl);
  }

  counterEl.textContent = `Blocked: ${hiddenTweetCount}`;
}

function hideTweets() {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  let newlyHidden = 0;

  tweets.forEach((tweet) => {
    if (tweet.dataset.processed === "true") return;

    let shouldHide = false;
    let matchedWord = "";
    let matchType = "";

    // 1. USERNAME BLOCKING CHECK
    if (enableUserBlocking && blockedUsers.length > 0) {
      // Check all possible username elements
      const usernameElements = [
        ...tweet.querySelectorAll('span[data-testid="User-Name"] span'), // New Twitter UI
        ...tweet.querySelectorAll('a[href*="/"]'), // Profile links
        ...tweet.querySelectorAll('div[data-testid="User-Name"]'), // Old Twitter UI
      ];

      for (const element of usernameElements) {
        const text = element.textContent || "";
        const href = element.getAttribute("href") || "";

        // Extract username from @mention text
        if (text.includes("@")) {
          const usernameMatch = text.match(/@(\w+)/i);
          if (usernameMatch) {
            const username = usernameMatch[1].toLowerCase();
            if (blockedUsers.includes(username)) {
              shouldHide = true;
              matchedWord = username;
              matchType = "username text match";
              break;
            }
          }
        }

        // Extract username from profile URL
        if (
          href.startsWith("/") &&
          !href.includes("/status/") &&
          href.split("/").length === 2
        ) {
          const username = href.split("/")[1].toLowerCase();
          if (blockedUsers.includes(username)) {
            shouldHide = true;
            matchedWord = username;
            matchType = "profile URL match";
            break;
          }
        }
      }
    }

    // 2. GENERAL WORD BLOCKING (if user not blocked)
    if (!shouldHide && generalBlockedWords.length > 0) {
      const tweetText = (tweet.textContent || "").toLowerCase();
      for (const word of generalBlockedWords) {
        if (tweetText.includes(word.toLowerCase())) {
          shouldHide = true;
          matchedWord = word;
          matchType = "general word match";
          break;
        }
      }
    }

    // 3. LINK WORD BLOCKING (if not already hidden)
    if (!shouldHide && linkBlockedWords.length > 0) {
      const links = tweet.querySelectorAll("a[href]");
      for (const link of links) {
        const href = (link.getAttribute("href") || "").toLowerCase();

        // Skip profile links and Twitter's own domains
        if (
          href.startsWith("/") ||
          href.includes("twitter.com") ||
          href.includes("x.com")
        ) {
          continue;
        }

        // Enhanced URL parsing
        try {
          const url = new URL(
            href.startsWith("http") ? href : `https://${href}`,
          );
          const urlStr = url.href.toLowerCase();
          const urlPath = url.pathname.toLowerCase();
          const urlHost = url.hostname.toLowerCase();

          for (const word of linkBlockedWords) {
            const lowerWord = word.toLowerCase();
            // Check in entire URL, path segments, or domain parts
            if (
              urlStr.includes(lowerWord) ||
              urlPath.includes(lowerWord) ||
              urlHost.includes(lowerWord)
            ) {
              shouldHide = true;
              matchedWord = word;
              matchType = "link word match";
              break;
            }
          }
        } catch (e) {
          console.log("Error parsing URL:", href, e);
        }

        if (shouldHide) break;
      }
    }

    tweet.dataset.processed = "true";

    if (shouldHide) {
      tweet.style.display = "none";
      newlyHidden++;
      debugLog(`Blocked tweet (${matchType}): ${matchedWord}`);

      // AUTO-COLLECT USERNAMES
      if (autoCollectUsers && matchType.includes("word match")) {
        const userElement = tweet.querySelector(
          '[data-testid="User-Name"] a[href^="/"]',
        );
        if (userElement) {
          const username = userElement.getAttribute("href").split("/")[1];
          if (!collectedUsers.includes(username)) {
            collectedUsers.push(username);
            chrome.storage.sync.get(["blockedUsers"], (result) => {
              const currentBlocked = result.blockedUsers || [];
              if (!currentBlocked.includes(username)) {
                chrome.storage.sync.set(
                  {
                    blockedUsers: [...currentBlocked, username],
                  },
                  () => {
                    debugLog(`Auto-added @${username} to blocked users`);
                  },
                );
              }
            });
          }
        }
      }
    }
  });

  if (newlyHidden > 0) {
    hiddenTweetCount += newlyHidden;
    updateCounterDisplay();
  }
}

function observeTwitterFeed() {
  const twitterFeed =
    document.querySelector('div[aria-label="Timeline: Your Home Timeline"]') ||
    document.querySelector('main[role="main"]') ||
    document.querySelector('div[data-testid="primaryColumn"]');

  if (twitterFeed) {
    const observer = new MutationObserver(function (mutations) {
      hideTweets();
    });

    observer.observe(twitterFeed, {
      childList: true,
      subtree: true,
    });

    debugLog("Twitter feed observer set up");
  } else {
    setTimeout(observeTwitterFeed, 1000);
  }
}

function loadBlockedWords() {
  hiddenTweetCount = 0;

  chrome.storage.sync.get(
    [
      "generalBlockedWords",
      "linkBlockedWords",
      "blockedUsers",
      "enableUserBlocking",
      "autoCollectUsers",
    ],
    function (result) {
      generalBlockedWords = result.generalBlockedWords || [];
      linkBlockedWords = result.linkBlockedWords || [];
      blockedUsers = result.blockedUsers || [];
      enableUserBlocking = result.enableUserBlocking || false;
      autoCollectUsers = result.autoCollectUsers !== false;

      debugLog("Loaded settings:", {
        generalBlockedWords,
        linkBlockedWords,
        blockedUsers,
        enableUserBlocking,
        autoCollectUsers,
      });

      hideTweets();
      observeTwitterFeed();
      updateCounterDisplay();
    },
  );
}

// Initialize when the page loads
loadBlockedWords();

// Re-run when navigating between Twitter pages
window.addEventListener("load", loadBlockedWords);
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) {
    hideTweets();
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "userBlocked") {
    // Clear any existing notification timeout
    if (notificationTimeout) clearTimeout(notificationTimeout);

    // Update local blockedUsers array
    if (!blockedUsers.includes(message.username)) {
      blockedUsers.push(message.username);
      hiddenTweetCount++; // Increment counter for the immediate block
      updateCounterDisplay();

      // Re-run hiding to catch tweets from newly blocked user
      hideTweets();

      // Show a notification to the user
      const existingNotification = document.querySelector(
        ".block-notification",
      );
      if (existingNotification) existingNotification.remove();

      const notification = document.createElement("div");
      notification.textContent = `✓ @${message.username} blocked`;
      notification.className = "block-notification";
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #1da1f2;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-weight: bold;
        z-index: 9999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: fadeIn 0.3s;
      `;

      document.body.appendChild(notification);

      // Remove notification after 3 seconds
      notificationTimeout = setTimeout(() => {
        notification.style.animation = "fadeOut 0.5s";
        setTimeout(() => notification.remove(), 500);
      }, 3000);
    }
  }

  if (message.action === "forceUpdateBlockLists") {
    generalBlockedWords = message.data.generalBlockedWords;
    linkBlockedWords = message.data.linkBlockedWords;
    blockedUsers = message.data.blockedUsers;
    enableUserBlocking = message.data.enableUserBlocking;
    autoCollectUsers = message.data.autoCollectUsers;

    debugLog("Received forced update:", message.data);
    hideTweets(); // Re-process all tweets immediately

    // Show brief notification
    const notice = document.createElement("div");
    notice.textContent = "Block lists updated";
    notice.style.cssText = `
      position: fixed;
      bottom: 60px;
      right: 20px;
      background: #1da1f2;
      color: white;
      padding: 8px 12px;
      border-radius: 20px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      animation: fadeInOut 2.5s;
    `;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 2500);
  }
});

// Add this CSS for animations
const style = document.createElement("style");
style.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(10px); }
    10% { opacity: 1; transform: translateY(0); }
    90% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(10px); }
  }
`;
document.head.appendChild(style);
