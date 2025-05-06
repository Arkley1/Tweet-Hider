let generalBlockedWords = []; // Tweet word blocklist
let linkBlockedWords = []; // Tweet link word blocklist
let blockedUsers = []; // Username blocklist
let enableUserBlocking = false;
let debugMode = false; // Debug mode for output console.log
let hiddenTweetCount = 0;
let autoCollectUsers = true;
let collectedUsers = []; // Track users we've found

function debugLog(...args) {
  if (debugMode) {
    console.log("[Twitter Word Blocker]", ...args);
  }
}

// Show tweet block count
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

// Hide Tweet
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
        for (const word of linkBlockedWords) {
          if (href.includes(word.toLowerCase())) {
            shouldHide = true;
            matchedWord = word;
            matchType = "link word match";
            break;
          }
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
          '[data-testid="User-Name"] a[href^="/"]'
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
                  }
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
      "autoCollectUsers"
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
        autoCollectUsers
      });

      hideTweets();
      observeTwitterFeed();
      updateCounterDisplay();
    }
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
