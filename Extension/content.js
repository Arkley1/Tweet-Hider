let generalBlockedWords = [];
let notificationTimeout;
let linkBlockedWords = [];
let blockedUsers = [];
let enableUserBlocking = false;
let debugMode = true;
let hiddenTweetCount = 0;
let autoCollectUsers = true;
let collectedUsers = []; // Track users we've found

// Add these translations at the top of content.js
const translations = {
  en: {
    blockedCounter: "Blocked: ",
    userBlockedNotification: " has been blocked",
    autoAddedUser: "Auto-added @ to blocked users",
  },
  id: {
    blockedCounter: "Diblokir: ",
    userBlockedNotification: " telah diblokir",
    autoAddedUser: "Secara otomatis menambahkan @ ke pengguna yang diblokir",
  },
};

let currentLang = "en"; // Default language

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

  counterEl.textContent = `${translations[currentLang].blockedCounter}${hiddenTweetCount}`;
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

        // Skip all Twitter/X links and mentions
        if (
          href.startsWith("/") || // Relative links
          href.includes("twitter.com") ||
          href.includes("x.com") ||
          href.startsWith("#") || // Hashtags
          href.startsWith("@") // Mentions
        ) {
          
          continue;
        }

        try {
          // Parse URL to properly check domains
          const url = new URL(
            href.startsWith("http") ? href : `https://${href}`,
          );
          const domain = url.hostname.replace("www.", "");

          // Check each blocked word against domain only
          for (const word of linkBlockedWords) {
            const lowerWord = word.toLowerCase();

            // Check if domain contains the blocked word
            if (domain.includes(lowerWord)) {
              shouldHide = true;
              matchedWord = word;
              matchType = "link domain match";
              debugLog(`Blocked domain: ${domain} for word: ${word}`);
              break;
            }
          }
        } catch (e) {
          debugLog("Error parsing URL:", href, e);
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

function inspectTweetForDebugging(tweetId) {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  tweets.forEach((tweet) => {
    // Check if this is the tweet we're looking for
    const links = tweet.querySelectorAll("a[href]");
    let foundMatch = false;

    links.forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href.includes(tweetId)) {
        foundMatch = true;
        console.log("FOUND TARGET TWEET:", tweet);
        console.log("Tweet content:", tweet.textContent);
        console.log("Links in tweet:");

        tweet.querySelectorAll("a[href]").forEach((l) => {
          console.log("  Link:", l.getAttribute("href"));
        });

        // Highlight the tweet for visual identification
        tweet.style.border = "3px solid red";
      }
    });
  });
}

// Call this with the tweet ID you want to inspect
// e.g., inspectTweetForDebugging("1919766745725993286");

function loadBlockedWords() {
  hiddenTweetCount = 0;

  chrome.storage.sync.get(
    [
      "generalBlockedWords",
      "linkBlockedWords",
      "blockedUsers",
      "enableUserBlocking",
      "autoCollectUsers",
      "language",
    ],
    function (result) {
      generalBlockedWords = result.generalBlockedWords || [];
      linkBlockedWords = result.linkBlockedWords || [];
      blockedUsers = result.blockedUsers || [];
      enableUserBlocking = result.enableUserBlocking || false;
      autoCollectUsers = result.autoCollectUsers !== false;
      currentLang = result.language || "en";

      debugLog("Loaded settings:", {
        generalBlockedWords,
        linkBlockedWords,
        blockedUsers,
        enableUserBlocking,
        autoCollectUsers,
        language: currentLang,
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
    // Update local blockedUsers array
    if (!blockedUsers.includes(message.username)) {
      blockedUsers.push(message.username);

      // Re-run hiding to catch tweets from newly blocked user
      hideTweets();

      // Show a notification to the user
      const notification = document.createElement("div");
      notification.textContent = `@${message.username}${translations[currentLang].userBlockedNotification}`;
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: rgba(29, 155, 240, 0.9);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-weight: bold;
        z-index: 9999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      `;

      document.body.appendChild(notification);

      // Remove notification after 3 seconds
      setTimeout(() => {
        notification.style.opacity = "0";
        notification.style.transition = "opacity 0.5s";
        setTimeout(() => notification.remove(), 500);
      }, 3000);
    }
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
