let generalBlockedWords = [];
let notificationTimeout;
let linkBlockedWords = [];
let blockedUsers = [];
let enableUserBlocking = false;
let debugMode = false; // Default to false, will be updated from storage
let hiddenTweetCount = 0;
let autoCollectUsers = true;
let collectedUsers = []; // Track users we've found

const hiddenTweetIds = new Set();

const SELECTORS = {
  // Primary selectors (ordered by reliability)
  TWEET: [
    // ARIA role-based (most stable)
    '[role="article"][aria-labelledby]',

    // Structural patterns (less likely to change)
    'article[tabindex="-1"]',
    'div[data-testid="tweet"]', // Keep as fallback

    // Content-based patterns
    'div:has(> div > div > [data-testid="User-Name"])',
  ],

  // Other supporting selectors
  USERNAME: [
    '[data-testid="User-Name"] a[href^="/"]',
    '[role="group"] a[href^="/"][role="link"]:has(> div > span)',
  ],
  TWEET_TEXT: ['div[data-testid="tweetText"]', "div[lang]:has(> span)"],
  LINKS: "a[href]",
};

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
  // Get all potential tweet containers using multiple selectors
  const tweetContainers = [];

  // Try each selector in order until we find matches
  for (const selector of SELECTORS.TWEET) {
    const matches = document.querySelectorAll(selector);
    for (const el of matches) {
      if (!el.hasAttribute("data-tweet-hidden")) {
        tweetContainers.push(el);
      }
    }
    // If we found some with this selector, use them
    if (tweetContainers.length > 0) break;
  }

  if (!tweetContainers.length) return;

  let newlyHidden = 0;
  const currentHiddenIds = new Set();

  // Process in batches
  const processBatch = (start, end) => {
    for (let i = start; i < end; i++) {
      const container = tweetContainers[i];

      // Skip if already processed
      if (container.hasAttribute("data-tweet-hidden")) continue;

      // Get tweet ID using multiple methods
      const tweetId = getTweetId(container);
      if (!tweetId || hiddenTweetIds.has(tweetId)) continue;

      if (shouldHideTweet(container)) {
        container.style.display = "none";
        container.setAttribute("data-tweet-hidden", "true");
        hiddenTweetIds.add(tweetId);
        newlyHidden++;
        currentHiddenIds.add(tweetId);
      }
    }

    if (end < tweetContainers.length) {
      requestAnimationFrame(() =>
        processBatch(end, Math.min(end + 5, tweetContainers.length)),
      );
    } else {
      if (newlyHidden > 0) {
        hiddenTweetCount += newlyHidden;
        updateCounterDisplay();
      }
      cleanupHiddenIds(currentHiddenIds);
    }
  };

  processBatch(0, Math.min(5, tweetContainers.length));
}

// Helper function to find first matching element
function findFirstMatch(element, selectors) {
  if (typeof selectors === "string") {
    return element.querySelector(selectors);
  }

  // Try each selector in order until we find a match
  for (const selector of selectors) {
    const match = element.querySelector(selector);
    if (match) return match;
  }
  return null;
}

// More robust tweet ID extraction
function getTweetId(tweetElement) {
  // Try status link first
  const statusLink = findFirstMatch(tweetElement, [
    'a[href*="/status/"]',
    'a[href*="/i/status/"]',
  ]);

  if (statusLink) {
    const url = new URL(statusLink.href, location.href);
    return url.pathname.split("/").pop();
  }

  // Fallback to data attributes
  return (
    tweetElement.dataset.tweetId ||
    tweetElement.closest("[data-tweet-id]")?.dataset.tweetId
  );
}

function cleanupHiddenIds(currentIds) {
  // Remove IDs of tweets that are no longer in DOM
  for (const id of hiddenTweetIds) {
    if (
      !currentIds.has(id) &&
      !document.querySelector(`[data-tweet-id="${id}"]`)
    ) {
      hiddenTweetIds.delete(id);
    }
  }
}

function validateSelectors() {
  const testTweet = findFirstMatch(document.body, SELECTORS.TWEET);
  if (!testTweet) {
    console.warn("Primary tweet selectors failed, falling back to deep scan");
    // Implement deep scan fallback
    return deepScanForTweets();
  }
}

// Fallback deep scanning method
function deepScanForTweets() {
  // Look for elements with common tweet patterns
  return Array.from(document.querySelectorAll("article, div")).filter((el) => {
    return (
      el.querySelector('[data-testid="User-Name"]') ||
      el.querySelector('a[href*="/status/"]') ||
      (el.textContent && el.textContent.includes("@"))
    );
  });
}

let effectiveSelectors = {
  TWEET: [...SELECTORS.TWEET], // Start with original order
  lastVerified: Date.now(),
};

// Periodically reorder selectors based on what works
function optimizeSelectors() {
  const now = Date.now();
  if (now - effectiveSelectors.lastVerified < 60000) return; // Only check once per minute

  const workingSelectors = [];

  // Test each selector
  for (const selector of effectiveSelectors.TWEET) {
    if (document.querySelector(selector)) {
      workingSelectors.push(selector);
    }
  }

  // Update if we found changes
  if (
    workingSelectors.length !== effectiveSelectors.TWEET.length ||
    workingSelectors.some((s, i) => s !== effectiveSelectors.TWEET[i])
  ) {
    effectiveSelectors.TWEET = workingSelectors;
    effectiveSelectors.lastVerified = now;
  }
}

function shouldHideTweet(tweet) {
  // Combined check with early returns
  return (
    shouldHideByUsername(tweet) ||
    shouldHideByGeneralWords(tweet) ||
    shouldHideByLinkWords(tweet)
  );
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

  const userElement = tweet.querySelector('[data-testid="User-Name"]');
  if (!userElement) return false;

  const usernameLink = userElement.querySelector('a[href^="/"]');
  if (!usernameLink) return false;

  const href = usernameLink.getAttribute("href");
  const username = href.split("/")[1]?.toLowerCase();

  if (username) {
    if (debugMode) {
      // Debug mode - check and log which blocked user matched
      const matchedUser = blockedUsers.find(
        (u) => u.toLowerCase() === username,
      );
      if (matchedUser) {
        debugLog(`Hiding tweet from blocked user: ${matchedUser}`);
        return true;
      }
    } else {
      // Production mode - use some() for maximum performance
      return blockedUsers.some((u) => u.toLowerCase() === username);
    }
  }

  return false;
}

// Filter by General wordlist
function shouldHideByGeneralWords(tweet) {
  if (generalBlockedWords.length === 0) return false;

  const textElements = tweet.querySelectorAll(
    'div[data-testid="tweetText"], div[lang]:has(> span)',
  );
  if (!textElements.length) return false;

  const combinedText = Array.from(textElements)
    .map((el) => el.textContent || "")
    .join(" ")
    .toLowerCase();

  if (debugMode) {
    // Debug mode - use find() to get the matched word for logging
    const matchedWord = generalBlockedWords.find((word) =>
      combinedText.includes(word.toLowerCase()),
    );

    if (matchedWord) {
      const username = getUsernameFromTweet(tweet);
      debugLog(
        `Hiding tweet containing "${matchedWord}" in post by @${username}`,
      );

      if (autoCollectUsers && username) {
        collectUserFromTweet(tweet);
      }
      return true;
    }
  } else {
    // Production mode - use some() for maximum performance
    const blockedTerms = generalBlockedWords.map((w) => w.toLowerCase());
    if (blockedTerms.some((term) => combinedText.includes(term))) {
      const username = getUsernameFromTweet(tweet);

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
  if (linkBlockedWords.length === 0) return false;

  const links = tweet.querySelectorAll("a[href]");
  if (!links.length) return false;

  const blockedDomains = linkBlockedWords.map((w) => w.toLowerCase());

  for (const link of links) {
    const href = (link.getAttribute("href") || "").toLowerCase();

    // Skip Twitter links early
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

      if (debugMode) {
        // Debug mode - find and log exact matched domain
        const matchedDomain = blockedDomains.find((d) => domain.includes(d));
        if (matchedDomain) {
          const username = getUsernameFromTweet(tweet);
          debugLog(
            `Found blocked link domain "${matchedDomain}" in "${url}" from @${username}`,
          );
          if (autoCollectUsers && username) collectUserFromTweet(tweet);
          return true;
        }
      } else {
        // Production mode - use some() for maximum performance
        if (blockedDomains.some((d) => domain.includes(d))) {
          const username = getUsernameFromTweet(tweet);
          if (autoCollectUsers && username) collectUserFromTweet(tweet);
          return true;
        }
      }
    } catch (e) {
      debugMode && debugLog("Error parsing URL:", href, e);
    }
  }
  return false;
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

let currentObserver = null;
let lastKnownPath = window.location.pathname;
let lastKnownContainer = null;

function observeTwitterFeed() {
  // Clear existing observer
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
  }

  const findTweetContainer = () => {
    const selectors = [
      'div[aria-label="Timeline: Your Home Timeline"] > div > div',
      'div[aria-label="Timeline: Search timeline"] > div > div',
      'div[aria-label="Timeline: Trending timeline"] > div > div',
      'div[aria-label="Timeline: Profile timeline"] > div > div',
      'div[data-testid="primaryColumn"] section[role="region"]',
      'div[data-testid="primaryColumn"]',
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        //debugLog(`Found container with selector: ${selector}`);
        return container;
      }
    }
    return null;
  };

  const tweetContainer = findTweetContainer();

  if (!tweetContainer) {
    debugLog("Tweet container not found, retrying...");
    setTimeout(observeTwitterFeed, 500);
    return;
  }

  const handleMutations = (mutations) => {
    // Check if URL changed (SPA navigation)
    if (window.location.pathname !== lastKnownPath) {
      lastKnownPath = window.location.pathname;
      debugLog(`URL changed to: ${lastKnownPath}, reinitializing...`);
      observeTwitterFeed();
      return;
    }

    // Standard mutation handling
    if (window.tweetHiderDebounce) {
      clearTimeout(window.tweetHiderDebounce);
    }

    window.tweetHiderDebounce = setTimeout(() => {
      const needsCheck = mutations.some((mutation) => {
        return (
          (mutation.addedNodes && mutation.addedNodes.length > 0) ||
          (mutation.type === "attributes" &&
            mutation.attributeName === "aria-label")
        );
      });

      if (needsCheck) {
        debugLog("Processing mutations...");
        hideTweets();
      }
    }, 100);
  };

  const observer = new MutationObserver((mutations) => {
    optimizeSelectors(); // Check for selector changes

    const hasNewTweets = mutations.some((mutation) => {
      return Array.from(mutation.addedNodes || []).some((node) => {
        if (node.nodeType !== 1) return false;

        // Use our effective selectors
        return effectiveSelectors.TWEET.some(
          (selector) => node.matches(selector) || node.querySelector(selector),
        );
      });
    });

    if (hasNewTweets) hideTweets();
  });

  currentObserver = new MutationObserver(handleMutations);
  currentObserver.observe(tweetContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });

  // Also observe the document body for URL changes
  const urlObserver = new MutationObserver(() => {
    if (window.location.pathname !== lastKnownPath) {
      lastKnownPath = window.location.pathname;
      debugLog(`URL changed to: ${lastKnownPath}, reinitializing...`);
      observeTwitterFeed();
    }
  });

  urlObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  //debugLog('Observer initialized for current view');
  hideTweets(); // Initial check
}

// Add periodic check for view changes
setInterval(() => {
  const currentContainer = document.querySelector(
    'div[data-testid="primaryColumn"] section[role="region"]',
  );
  if (currentContainer && !currentContainer.isConnected) {
    //debugLog('Container disconnected, reinitializing...');
    observeTwitterFeed();
  }
}, 2000);

// Initialize
observeTwitterFeed();

// Reset when page becomes visible
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    observeTwitterFeed();
  }
});

function handleSPANavigation() {
  const navObserver = new MutationObserver(() => {
    if (!lastKnownContainer || !document.body.contains(lastKnownContainer)) {
      //debugLog('SPA navigation detected, reinitializing...');
      observeTwitterFeed();
    }
  });

  navObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Initialize everything
function initObserver() {
  observeTwitterFeed();
  handleSPANavigation();

  // Reset when page becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      observeTwitterFeed();
    }
  });
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
	  "debugMode"
    ],
    function (result) {
      generalBlockedWords = result.generalBlockedWords || [];
      linkBlockedWords = result.linkBlockedWords || [];
      blockedUsers = result.blockedUsers || [];
      enableUserBlocking = result.enableUserBlocking || false;
      autoCollectUsers = result.autoCollectUsers !== false;
      currentLang = result.language || "en";
	  debugMode = result.debugMode || false;

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
      updateCounterDisplay();
      initObserver();
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
  else if (message.action === "updateDebugMode") {
    debugMode = message.debugMode;
    debugLog(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
  }
  else if (message.action === "forceUpdateBlockLists") {
    // Update all internal variables from the message data
    generalBlockedWords = message.data.generalBlockedWords || [];
    linkBlockedWords = message.data.linkBlockedWords || [];
    blockedUsers = message.data.blockedUsers || [];
    enableUserBlocking = message.data.enableUserBlocking || false;
    autoCollectUsers = message.data.autoCollectUsers !== false;
    debugMode = message.data.debugMode || false;
    
    // Update language if provided
    if (message.data.language && message.data.language !== currentLang) {
      currentLang = message.data.language;
    }

    debugLog("Received updated block lists:", {
      generalBlockedWords: generalBlockedWords.length,
      linkBlockedWords: linkBlockedWords.length,
      blockedUsers: blockedUsers.length,
      enableUserBlocking,
      autoCollectUsers,
      debugMode,
      currentLang
    });

    // Clear existing hidden tweets to re-evaluate all visible tweets
    resetHiddenTweets();
    
    // Apply changes immediately
    hideTweets();
    updateCounterDisplay();
  }
});

// Helper function to clear existing hidden tweets
function resetHiddenTweets() {
  // Show all previously hidden tweets
  document.querySelectorAll('[data-tweet-hidden="true"]').forEach(tweet => {
    tweet.style.display = "";
    tweet.removeAttribute('data-tweet-hidden');
  });
  
  // Clear the hidden tweet IDs set
  hiddenTweetIds.clear();
  
  // Reset counter
  hiddenTweetCount = 0;
}
