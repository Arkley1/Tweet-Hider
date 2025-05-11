let generalBlockedWords = [];
let notificationTimeout;
let linkBlockedWords = [];
let blockedUsers = [];
let enableUserBlocking = false;
let debugMode = false; // For output console log
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
    console.log("[Tweet Hider]", ...args);
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

// Tweet Hide Filter
function hideTweets() {
  const tweets = document.querySelectorAll(
    'article[data-testid="tweet"]:not([data-processed="true"])',
  );
  let newlyHidden = 0;

  debugLog(`Checking ${tweets.length} new tweets`);

  const processTweetBatch = (startIndex, batchSize) => {
    const endIndex = Math.min(startIndex + batchSize, tweets.length);

    for (let i = startIndex; i < endIndex; i++) {
      const tweet = tweets[i];
      tweet.dataset.processed = "true";

      const hiddenByUsername = shouldHideByUsername(tweet);
      const hiddenByGeneralWords = shouldHideByGeneralWords(tweet);
      const hiddenByLinkWords = shouldHideByLinkWords(tweet);

      if (hiddenByUsername || hiddenByGeneralWords || hiddenByLinkWords) {
        if (tweet.style.display !== "none") {
          tweet.style.display = "none";
          newlyHidden++;
        }
      }
    }

    if (endIndex < tweets.length) {
      (window.requestIdleCallback || setTimeout)(() => {
        processTweetBatch(endIndex, batchSize);
      });
    } else if (newlyHidden > 0) {
      hiddenTweetCount += newlyHidden;
      updateCounterDisplay();
    }
  };

  if (tweets.length > 0) {
    processTweetBatch(0, 10);
  }
}

// Helper function to get username from tweet
function getUsernameFromTweet(tweet) {
  const userElement = tweet.querySelector(
    '[data-testid="User-Name"] a[href^="/"]',
  );
  return userElement ? userElement.getAttribute("href").split("/")[1] : null;
}

// Filter by Username
function shouldHideByUsername(tweet) {
  if (!enableUserBlocking || blockedUsers.length === 0) return false;

  // Cache username elements for better performance
  const usernameElements = tweet.querySelectorAll(
    'a[href^="/"]:not([href*="/status/"])',
  );

  for (const element of usernameElements) {
    const href = element.getAttribute("href");
    if (href && href.startsWith("/")) {
      const username = href.split("/")[1]?.toLowerCase();
      if (username && blockedUsers.includes(username)) {
        debugLog(`Hiding tweet from blocked user: ${username}`);
        return true;
      }
    }
  }

  return false;
}

// Filter by General wordlist
function shouldHideByGeneralWords(tweet) {
  if (generalBlockedWords.length === 0) return false;

  const tweetText = tweet.textContent?.toLowerCase() || "";

  for (const word of generalBlockedWords) {
    if (tweetText.includes(word.toLowerCase())) {
      const username = getUsernameFromTweet(tweet);
      debugLog(`Hiding tweet containing "${word}" in post by ${username}`);

      // Auto-collect user if enabled
      if (autoCollectUsers && username) {
        collectUserFromTweet(tweet);
      }
      return true;
    }
  }

  return false;
}

// Filter by link wordlist
function shouldHideByLinkWords(tweet) {
  //Link words list is empty - skipping link check
  if (linkBlockedWords.length === 0) { 
    return false;
  }

  const links = tweet.querySelectorAll("a[href]");
  let shouldHide = false;

  for (const link of links) {
    const href = (link.getAttribute("href") || "").toLowerCase();

    // Skip all Twitter/X links and mentions
    if (
      href.startsWith("/") ||
      href.includes("twitter.com") ||
      href.includes("x.com") ||
      href.startsWith("#") ||
      href.startsWith("@")
    ) {
      continue;
    }

    try {
      const url = new URL(href.startsWith("http") ? href : `https://${href}`);
      const domain = url.hostname.replace("www.", "");

      for (const word of linkBlockedWords) {
        const lowerWord = word.toLowerCase();
        if (domain.includes(lowerWord)) {
          const username = getUsernameFromTweet(tweet);
          debugLog(
            `Found blocked link word "${word}" in domain ${domain} from @${username}`,
          );

          if (autoCollectUsers && username) {
            collectUserFromTweet(tweet);
          }

          shouldHide = true;
          break; // No need to check other words for this link
        }
      }

      if (shouldHide) break; // No need to check other links if we found a match
    } catch (e) {
      debugLog("Error parsing URL:", href, e);
    }
  }
  return shouldHide;
}

// Helper function to collect username from tweet for auto-blocking
function collectUserFromTweet(tweet) {
  const userElement = tweet.querySelector(
    '[data-testid="User-Name"] a[href^="/"]',
  );
  if (!userElement) return;

  const username = userElement.getAttribute("href").split("/")[1];
  if (!username || collectedUsers.includes(username)) return;

  collectedUsers.push(username);

  chrome.storage.sync.get(["blockedUsers"], (result) => {
    const currentBlocked = result.blockedUsers || [];
    if (!currentBlocked.includes(username)) {
      chrome.storage.sync.set(
        { blockedUsers: [...currentBlocked, username] },
        () => debugLog(`Auto-added @${username} to blocked users`),
      );
    }
  });
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
      "language",
    ],
    function (result) {
      generalBlockedWords = result.generalBlockedWords || [];
      linkBlockedWords = result.linkBlockedWords || [];
      blockedUsers = result.blockedUsers || [];
      enableUserBlocking = result.enableUserBlocking || false;
      autoCollectUsers = result.autoCollectUsers !== false;
      currentLang = result.language || "en";

      /*
	  debugLog("Loaded settings:", {
        generalBlockedWords,
        linkBlockedWords,
        blockedUsers,
        enableUserBlocking,
        autoCollectUsers,
        language: currentLang,
      });
	  */

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
