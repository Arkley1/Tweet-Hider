// == Tweet Hider - Content Script ==
// This script is injected into Twitter/X pages to hide tweets based on user-defined criteria.
// It observes the DOM for new tweets and applies filtering rules.

// --- Global Variables & Constants ---

// Stores words that, if found in tweet text, will cause the tweet to be hidden.
let generalBlockedWords = [];
// Stores words that, if found in links within a tweet, will cause the tweet to be hidden.
let linkBlockedWords = [];
// Stores usernames whose tweets should be hidden.
let blockedUsers = [];
// Flag to enable/disable hiding tweets based on the blockedUsers list.
let enableUserBlocking = false;
// Flag to enable/disable detailed console logging for debugging.
let debugMode = false;
// Counter for the number of tweets hidden in the current session.
let hiddenTweetCount = 0;
// Flag to enable/disable automatically adding users to the blocklist if their tweets contain blocked words/links.
let autoCollectUsers = true;
// Tracks users who have been identified for auto-collection to avoid redundant processing.
let collectedUsers = [];
// A Set to store the IDs of tweets that have been hidden to prevent re-processing.
const hiddenTweetIds = new Set();
// Timeout ID for the user blocked notification.
let notificationTimeout;

// Selectors used to identify tweets and their components.
// Ordered by perceived stability, with more robust selectors (ARIA roles) preferred.
const SELECTORS = {
  TWEET: [
    '[role="article"][aria-labelledby]', // ARIA role-based (most stable)
    'article[tabindex="-1"]', // Structural pattern
    'div[data-testid="tweet"]', // Common test ID (fallback)
    'div:has(> div > div > [data-testid="User-Name"])', // Content-based pattern
  ],
  USERNAME: [ // Selectors for extracting usernames
    '[data-testid="User-Name"] a[href^="/"]',
    '[role="group"] a[href^="/"][role="link"]:has(> div > span)',
  ],
  TWEET_TEXT: ['div[data-testid="tweetText"]', "div[lang]:has(> span)"], // Selectors for tweet text content
  LINKS: "a[href]", // Selector for all links within a tweet
};

// Translations for UI elements displayed by this script (e.g., counter, notifications).
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
// Stores the current language setting for translations.
let currentLang = "en";

// --- Logging ---

/**
 * Logs messages to the console if debugMode is enabled.
 * @param {...any} args - Arguments to log.
 */
function debugLog(...args) {
  if (debugMode) {
    console.log("[Tweet Hider]", ...args);
  }
}

// --- UI & Notifications ---

/**
 * Updates the on-screen counter displaying the number of hidden tweets.
 * Creates the counter element if it doesn't exist.
 */
function updateCounterDisplay() {
  let counterEl = document.getElementById("tweet-blocker-counter");

  if (!counterEl) {
    counterEl = document.createElement("div");
    counterEl.id = "tweet-blocker-counter";
    // Styling for the counter
    counterEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: rgba(29, 155, 240, 0.9); /* Twitter blue */
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
  // Update counter text with current language translation.
  counterEl.textContent = `${translations[currentLang].blockedCounter}${hiddenTweetCount}`;
}

/**
 * Displays a temporary notification on the screen.
 * @param {string} messageText - The text to display in the notification.
 */
function showNotification(messageText) {
  // Clear existing notification timeout if any
  if (notificationTimeout) clearTimeout(notificationTimeout);

  // Remove existing notification element if any
  const existingNotification = document.getElementById("tweet-hider-notification");
  if (existingNotification) existingNotification.remove();

  const notification = document.createElement("div");
  notification.id = "tweet-hider-notification";
  notification.textContent = messageText;
  // Styling for the notification
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: rgba(29, 155, 240, 0.9); /* Twitter blue */
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-weight: bold;
    z-index: 10000; /* Ensure it's above other elements */
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    opacity: 0;
    transform: translateY(-10px);
    animation: fadeInNotification 0.3s forwards;
  `;

  // Add fade-in animation style
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInNotification {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeOutNotification {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-20px); }
    }
  `;
  document.head.appendChild(style); // Add styles to head for animations

  document.body.appendChild(notification);

  // Remove notification after 3 seconds with fade-out effect
  notificationTimeout = setTimeout(() => {
    notification.style.animation = "fadeOutNotification 0.5s forwards";
    setTimeout(() => {
      notification.remove();
      style.remove(); // Clean up the added style element
    }, 500);
  }, 3000);
}


// --- Core Tweet Hiding Logic ---

/**
 * Iterates through potential tweet elements on the page and hides them if they meet blocking criteria.
 * Uses a batch processing approach with requestAnimationFrame for performance.
 */
function hideTweets() {
  debugLog("Starting hideTweets function");
  const tweetContainers = [];

  // Attempt to find tweet elements using the defined selectors in order of preference.
  for (const selector of effectiveSelectors.TWEET) {
    try {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) {
        // Only add if not already marked as hidden by this script.
        if (!el.hasAttribute("data-tweet-hidden")) {
          tweetContainers.push(el);
        }
      }
      if (tweetContainers.length > 0) {
        debugLog(`Found ${tweetContainers.length} potential tweets using selector: ${selector}`);
        break; // Use the first selector that yields results.
      }
    } catch (e) {
      debugLog(`Error with selector "${selector}":`, e);
    }
  }

  if (tweetContainers.length === 0) {
    debugLog("No new tweet containers found to process.");
    return;
  }

  let newlyHidden = 0;
  const currentTweetIdsOnPage = new Set(); // Track IDs of tweets currently visible/processed in this run.

  // Process tweets in batches to avoid freezing the browser.
  const processBatch = (startIndex, batchSize) => {
    const endIndex = Math.min(startIndex + batchSize, tweetContainers.length);
    debugLog(`Processing batch: ${startIndex} to ${endIndex-1}`);

    for (let i = startIndex; i < endIndex; i++) {
      const container = tweetContainers[i];

      // Skip if already processed by this script in a previous run.
      if (container.hasAttribute("data-tweet-hidden")) continue;

      const tweetId = getTweetId(container);
      currentTweetIdsOnPage.add(tweetId); // Add to current page IDs.

      // Skip if no ID or already in the global hidden set.
      if (!tweetId || hiddenTweetIds.has(tweetId)) {
        if (hiddenTweetIds.has(tweetId)) {
            // If it's in hiddenTweetIds but not marked with data-tweet-hidden, hide it again.
            // This can happen if resetHiddenTweets was called.
            container.style.display = "none";
            container.setAttribute("data-tweet-hidden", "true");
        }
        continue;
      }
      
      if (shouldHideTweet(container)) {
        debugLog(`Hiding tweet ID: ${tweetId || 'unknown'}`);
        container.style.display = "none";
        container.setAttribute("data-tweet-hidden", "true"); // Mark as hidden by this script.
        hiddenTweetIds.add(tweetId); // Add to the global set of hidden tweet IDs.
        newlyHidden++;
      }
    }

    // If there are more tweets to process, schedule the next batch.
    if (endIndex < tweetContainers.length) {
      requestAnimationFrame(() => processBatch(endIndex, batchSize));
    } else {
      // All batches processed.
      if (newlyHidden > 0) {
        hiddenTweetCount += newlyHidden;
        debugLog(`${newlyHidden} tweets newly hidden. Total hidden: ${hiddenTweetCount}`);
        updateCounterDisplay();
      }
      cleanupHiddenIds(currentTweetIdsOnPage); // Clean up old IDs.
      debugLog("Finished processing all batches.");
    }
  };
  // Start processing with a batch size of 5.
  processBatch(0, 5);
}

/**
 * Tries to extract a unique ID from a tweet element.
 * @param {HTMLElement} tweetElement - The tweet's DOM element.
 * @returns {string|null} The tweet ID or null if not found.
 */
function getTweetId(tweetElement) {
  // Attempt 1: Look for a link containing "/status/"
  const statusLink = findFirstMatch(tweetElement, ['a[href*="/status/"]', 'a[href*="/i/status/"]']);
  if (statusLink && statusLink.href) {
    try {
      const urlParts = statusLink.href.split('/');
      const statusIndex = urlParts.indexOf('status') > -1 ? urlParts.indexOf('status') : urlParts.indexOf('i');
      if (statusIndex !== -1 && urlParts.length > statusIndex + 1) {
        const id = urlParts[statusIndex + (urlParts[statusIndex] === 'i' ? 2 : 1)].split('?')[0];
        if (id && /^\d+$/.test(id)) return id; // Ensure it's a numeric ID
      }
    } catch (e) {
      debugLog("Error parsing tweet ID from status link:", statusLink.href, e);
    }
  }
  // Fallback: Check for data-tweet-id attribute on the element or its ancestors.
  return tweetElement.dataset.tweetId || tweetElement.closest("[data-tweet-id]")?.dataset.tweetId;
}


/**
 * Removes tweet IDs from the global `hiddenTweetIds` set if the corresponding tweets are no longer in the DOM.
 * This helps keep the set from growing indefinitely with stale data.
 * @param {Set<string>} currentIdsOnPage - A set of tweet IDs found on the page in the current `hideTweets` run.
 */
function cleanupHiddenIds(currentIdsOnPage) {
  let cleanedCount = 0;
  for (const id of hiddenTweetIds) {
    // If a hidden ID is not among the currently processed tweets AND its element is not in the DOM, remove it.
    if (!currentIdsOnPage.has(id) && !document.querySelector(`[data-tweet-id="${id}"], [href*="/status/${id}"]`)) {
      hiddenTweetIds.delete(id);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    debugLog(`Cleaned up ${cleanedCount} stale tweet IDs from hiddenTweetIds set.`);
  }
}

// --- Selector Optimization & Fallbacks ---
// Stores the currently effective selectors, potentially reordered for efficiency.
let effectiveSelectors = {
  TWEET: [...SELECTORS.TWEET],
  lastVerified: 0, // Timestamp of the last verification.
};

/**
 * Periodically checks and reorders tweet selectors based on which ones are currently finding elements.
 * This aims to prioritize selectors that are working on the current Twitter/X UI.
 */
function optimizeSelectors() {
  const now = Date.now();
  // Only run optimization check periodically (e.g., every 60 seconds).
  if (now - effectiveSelectors.lastVerified < 60000) return;

  debugLog("Running selector optimization...");
  const workingSelectors = [];
  const originalOrder = [...SELECTORS.TWEET]; // Keep original order for reference.

  // Test each selector from the original list.
  for (const selector of originalOrder) {
    if (document.querySelector(selector)) {
      workingSelectors.push(selector);
    }
  }

  // If working selectors are found and they differ from the current effective order, update.
  if (workingSelectors.length > 0 &&
      (workingSelectors.length !== effectiveSelectors.TWEET.length ||
       workingSelectors.some((s, i) => s !== effectiveSelectors.TWEET[i]))) {
    debugLog("Updating effective tweet selectors:", workingSelectors);
    effectiveSelectors.TWEET = workingSelectors;
  } else if (workingSelectors.length === 0) {
    // If no primary selectors work, revert to original to try again.
    debugLog("No primary selectors found working, reverting to original set for next attempt.");
    effectiveSelectors.TWEET = originalOrder;
  }
  effectiveSelectors.lastVerified = now;
}


/**
 * Fallback function to find tweets if primary selectors fail.
 * This is a broader scan and might be less performant or accurate.
 * @returns {Array<HTMLElement>} An array of potential tweet elements.
 */
function deepScanForTweets() {
  debugLog("Performing deep scan for tweets as primary selectors failed.");
  // Looks for common structural patterns or content indicative of a tweet.
  return Array.from(document.querySelectorAll("article, div")).filter((el) => {
    return (
      el.querySelector('[data-testid="User-Name"]') || // Contains a username element
      el.querySelector('a[href*="/status/"]') || // Contains a status link
      (el.textContent && el.textContent.includes("@") && el.textContent.length > 50) // Contains "@" and has some length
    );
  });
}

// --- Filtering Logic ---

/**
 * Determines if a given tweet should be hidden based on all active criteria.
 * @param {HTMLElement} tweet - The tweet element.
 * @returns {boolean} True if the tweet should be hidden, false otherwise.
 */
function shouldHideTweet(tweet) {
  // Checks each blocking condition. If any are true, the tweet is hidden.
  return (
    shouldHideByUsername(tweet) ||
    shouldHideByGeneralWords(tweet) ||
    shouldHideByLinkWords(tweet)
  );
}

/**
 * Extracts the username from a tweet element.
 * @param {HTMLElement} tweet - The tweet element.
 * @returns {string|null} The username (lowercase) or null if not found.
 */
function getUsernameFromTweet(tweet) {
  const userElement = findFirstMatch(tweet, SELECTORS.USERNAME);
  if (userElement && userElement.href) {
    // Assumes username is the part of the href after the first slash.
    // e.g., "/username" -> "username"
    return userElement.href.split("/")[1]?.toLowerCase();
  }
  return null;
}

/**
 * Checks if a tweet should be hidden based on the author's username.
 * @param {HTMLElement} tweet - The tweet element.
 * @returns {boolean} True if the tweet's author is in the blockedUsers list.
 */
function shouldHideByUsername(tweet) {
  if (!enableUserBlocking || blockedUsers.length === 0) return false;

  const username = getUsernameFromTweet(tweet);
  if (username) {
    const isBlocked = blockedUsers.some((blockedUser) => blockedUser.toLowerCase() === username);
    if (isBlocked) {
      debugLog(`Hiding tweet from blocked user: @${username}`);
      return true;
    }
  }
  return false;
}

/**
 * Checks if a tweet should be hidden based on keywords in its text content.
 * Also handles auto-collecting users if the feature is enabled.
 * @param {HTMLElement} tweet - The tweet element.
 * @returns {boolean} True if the tweet contains any generalBlockedWords.
 */
function shouldHideByGeneralWords(tweet) {
  if (generalBlockedWords.length === 0) return false;

  const textElements = tweet.querySelectorAll(SELECTORS.TWEET_TEXT.join(', '));
  if (textElements.length === 0) return false;

  // Combine text from all relevant elements.
  const combinedText = Array.from(textElements)
    .map((el) => el.textContent || "")
    .join(" ")
    .toLowerCase();

  const matchedWord = generalBlockedWords.find((word) => combinedText.includes(word.toLowerCase()));

  if (matchedWord) {
    const username = getUsernameFromTweet(tweet);
    debugLog(`Hiding tweet by @${username || 'unknown'} containing general word: "${matchedWord}"`);
    if (autoCollectUsers && username) {
      collectUser(username); // Auto-collect user.
    }
    return true;
  }
  return false;
}

/**
 * Checks if a tweet should be hidden based on keywords in links within the tweet.
 * Also handles auto-collecting users if the feature is enabled.
 * @param {HTMLElement} tweet - The tweet element.
 * @returns {boolean} True if the tweet contains links with blocked keywords.
 */
function shouldHideByLinkWords(tweet) {
  if (linkBlockedWords.length === 0) return false;

  const links = tweet.querySelectorAll(SELECTORS.LINKS);
  if (links.length === 0) return false;

  for (const link of links) {
    const href = (link.getAttribute("href") || "").toLowerCase();
    // Skip internal Twitter/X links, relative links, or anchor links.
    if (href.startsWith("/") || href.includes("twitter.com") || href.includes("x.com") || href.startsWith("#") || href.startsWith("@")) {
      continue;
    }

    try {
      // Attempt to parse the URL to reliably get the hostname.
      const url = new URL(href.startsWith("http") ? href : `https://${href}`); // Prepend https if scheme is missing.
      const domain = url.hostname.replace(/^www\./, ""); // Normalize by removing "www."

      const matchedLinkWord = linkBlockedWords.find((blockedWord) => domain.includes(blockedWord.toLowerCase()));

      if (matchedLinkWord) {
        const username = getUsernameFromTweet(tweet);
        debugLog(`Hiding tweet by @${username || 'unknown'} containing link word "${matchedLinkWord}" in domain "${domain}" (URL: ${href})`);
        if (autoCollectUsers && username) {
          collectUser(username); // Auto-collect user.
        }
        return true;
      }
    } catch (e) {
      // Log error if URL parsing fails (e.g., invalid href).
      debugLog("Error parsing URL for link word check:", href, e);
    }
  }
  return false;
}

/**
 * Adds a user to the `collectedUsers` list and potentially to `chrome.storage.sync` if autoCollectUsers is enabled.
 * @param {string} username - The username to collect.
 */
function collectUser(username) {
  if (!username || collectedUsers.includes(username.toLowerCase())) return; // Already collected or no username.

  const lowerCaseUsername = username.toLowerCase();
  collectedUsers.push(lowerCaseUsername); // Add to session's collected list.
  debugLog(`User @${lowerCaseUsername} identified for auto-collection.`);

  // Add to persistent storage if not already there.
  chrome.storage.sync.get(["blockedUsers"], (result) => {
    const currentBlocked = result.blockedUsers || [];
    if (!currentBlocked.map(u => u.toLowerCase()).includes(lowerCaseUsername)) {
      const newBlockedUsers = [...currentBlocked, lowerCaseUsername]; // Add the new username.
      chrome.storage.sync.set({ blockedUsers: newBlockedUsers }, () => {
        // Update local variable as well for immediate effect in current session
        blockedUsers = newBlockedUsers;
        debugLog(`Auto-added @${lowerCaseUsername} to global blocked users list.`);
        showNotification(`@${lowerCaseUsername} ${translations[currentLang].autoAddedUser}`);
      });
    }
  });
}

// --- DOM Observation ---
let currentObserver = null; // Holds the active MutationObserver instance.
let lastKnownPath = window.location.pathname; // Tracks URL path for SPA navigation.
let observerDebounceTimeout = null; // Timeout for debouncing observer callbacks.

/**
 * Sets up a MutationObserver to watch for changes in the Twitter/X feed (new tweets).
 * Re-initializes if the main tweet container changes or URL path changes (SPA navigation).
 */
function observeTwitterFeed() {
  debugLog("Attempting to initialize MutationObserver...");
  // Disconnect any existing observer.
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
    debugLog("Disconnected previous observer.");
  }

  // Selectors for potential main tweet containers.
  const containerSelectors = [
    'div[aria-label*="Timeline:"] > div > div', // Common timeline container pattern
    'div[data-testid="primaryColumn"] section[role="region"]', // Primary content column
    'main[role="main"]', // Main content area
    'div[data-testid="primaryColumn"]',
  ];

  let tweetContainer = null;
  for (const selector of containerSelectors) {
    tweetContainer = document.querySelector(selector);
    if (tweetContainer) {
      debugLog(`Found tweet container with selector: ${selector}`);
      break;
    }
  }

  if (!tweetContainer) {
    debugLog("Tweet container not found. Retrying observer setup in 500ms.");
    setTimeout(observeTwitterFeed, 500); // Retry if container not found.
    return;
  }

  /**
   * Callback function for the MutationObserver.
   * Debounces calls to `hideTweets` to manage performance.
   * @param {Array<MutationRecord>} mutationsList - List of mutations that occurred.
   */
  const handleMutations = (mutationsList) => {
    // Optimize selectors periodically.
    optimizeSelectors();

    // Check if URL changed significantly (SPA navigation).
    if (window.location.pathname !== lastKnownPath) {
      debugLog(`URL changed from ${lastKnownPath} to ${window.location.pathname}. Re-initializing observer.`);
      lastKnownPath = window.location.pathname;
      resetHiddenTweets(); // Reset hidden state on major navigation.
      observeTwitterFeed(); // Re-initialize for the new page/view.
      return;
    }

    // Check if any mutations likely added new tweet elements.
    const newTweetsAdded = mutationsList.some((mutation) => {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        return Array.from(mutation.addedNodes).some(node =>
          node.nodeType === 1 && // Is an element node
          (effectiveSelectors.TWEET.some(sel => node.matches(sel) || node.querySelector(sel))) // Matches a tweet selector
        );
      }
      return false;
    });

    if (newTweetsAdded) {
      debugLog("Mutations detected, likely new tweets added. Debouncing hideTweets call.");
      // Debounce the hideTweets call to avoid rapid firing.
      if (observerDebounceTimeout) clearTimeout(observerDebounceTimeout);
      observerDebounceTimeout = setTimeout(() => {
        debugLog("Debounced hideTweets execution.");
        hideTweets();
      }, 200); // 200ms debounce interval.
    }
  };

  currentObserver = new MutationObserver(handleMutations);
  // Observe the identified container for child additions/removals and attribute changes.
  currentObserver.observe(tweetContainer, {
    childList: true, // Watch for direct children changes (tweets added/removed).
    subtree: true,   // Watch for changes in all descendants.
  });

  debugLog("MutationObserver initialized and observing tweet container.");
  hideTweets(); // Run once on initialization to catch existing tweets.
}

// --- Initialization & Event Listeners ---

/**
 * Loads all settings and blocked word lists from chrome.storage.sync.
 * Initializes the script's state based on these settings.
 */
function loadSettingsAndRun() {
  debugLog("Loading settings from chrome.storage...");
  hiddenTweetCount = 0; // Reset counter on load.

  chrome.storage.sync.get(
    [
      "generalBlockedWords",
      "linkBlockedWords",
      "blockedUsers",
      "enableUserBlocking",
      "autoCollectUsers",
      "language",
      "debugMode", // Load debugMode state.
    ],
    function (result) {
      generalBlockedWords = result.generalBlockedWords || [];
      linkBlockedWords = result.linkBlockedWords || [];
      blockedUsers = result.blockedUsers || [];
      enableUserBlocking = result.enableUserBlocking || false;
      autoCollectUsers = result.autoCollectUsers !== false; // Default to true if undefined.
      currentLang = result.language || "en";
      debugMode = result.debugMode || false; // Set script's debugMode.

      debugLog("Settings loaded:", {
        generalWords: generalBlockedWords.length,
        linkWords: linkBlockedWords.length,
        users: blockedUsers.length,
        userBlocking: enableUserBlocking,
        autoCollect: autoCollectUsers,
        lang: currentLang,
        debug: debugMode,
      });

      updateCounterDisplay(); // Update counter with loaded state.
      observeTwitterFeed();   // Start observing for tweets.
    }
  );
}

/**
 * Resets the state of hidden tweets.
 * Makes all currently hidden tweets visible again and clears tracking sets.
 * This is typically called when blocklists are updated.
 */
function resetHiddenTweets() {
  debugLog("Resetting hidden tweets. Making all previously hidden tweets visible for re-evaluation.");
  // Make all tweets previously hidden by this script visible again.
  document.querySelectorAll('[data-tweet-hidden="true"]').forEach(tweet => {
    tweet.style.display = ""; // Revert display style.
    tweet.removeAttribute('data-tweet-hidden'); // Remove our marker.
  });

  hiddenTweetIds.clear(); // Clear the set of known hidden tweet IDs.
  hiddenTweetCount = 0;   // Reset the session counter.
  updateCounterDisplay(); // Update the counter display.
}

// Listen for messages from the popup or background script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("Message received:", message);
  if (message.action === "userBlocked") {
    // Handle a user being blocked via the context menu.
    const usernameLower = message.username.toLowerCase();
    if (!blockedUsers.map(u=>u.toLowerCase()).includes(usernameLower)) {
      blockedUsers.push(usernameLower); // Add to local list.
      // No need to save to storage here, background.js does that.
      debugLog(`User @${usernameLower} added to local blocklist via context menu.`);
      resetHiddenTweets(); // Reset and re-filter to hide tweets from newly blocked user.
      hideTweets();
      showNotification(`@${message.username} ${translations[currentLang].userBlockedNotification}`);
    }
  } else if (message.action === "updateDebugMode") {
    // Handle debug mode being toggled from the popup.
    debugMode = message.debugMode;
    debugLog(`Debug mode ${debugMode ? 'enabled' : 'disabled'} via popup.`);
    // No need to re-hide tweets, just affects logging.
  } else if (message.action === "forceUpdateBlockLists") {
    // Handle settings being updated from the popup.
    debugLog("Received forceUpdateBlockLists message from popup. Updating settings...");
    generalBlockedWords = message.data.generalBlockedWords || [];
    linkBlockedWords = message.data.linkBlockedWords || [];
    blockedUsers = message.data.blockedUsers || [];
    enableUserBlocking = message.data.enableUserBlocking || false;
    autoCollectUsers = message.data.autoCollectUsers !== false;
    debugMode = message.data.debugMode || false; // Update debugMode from popup data.
    if (message.data.language && message.data.language !== currentLang) {
      currentLang = message.data.language;
      debugLog("Language updated to:", currentLang);
    }

    debugLog("Local settings updated:", {
        generalWords: generalBlockedWords.length,
        linkWords: linkBlockedWords.length,
        users: blockedUsers.length,
        userBlocking: enableUserBlocking,
        autoCollect: autoCollectUsers,
        debug: debugMode,
        lang: currentLang
    });

    resetHiddenTweets(); // Reset hidden state.
    hideTweets();        // Re-apply filters with new settings.
  }
});

// Helper to find the first matching element from an array of selectors within a parent.
function findFirstMatch(element, selectors) {
    if (!element) return null;
    for (const selector of selectors) {
        const match = element.querySelector(selector);
        if (match) return match;
    }
    return null;
}

// --- Script Entry Point ---
// Initial load of settings and start of operations.
// Using a DOMContentLoaded listener or similar robust starting point.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSettingsAndRun);
} else {
    loadSettingsAndRun(); // Already loaded
}

// Additional listener for page visibility changes.
// Twitter/X is a SPA, but sometimes full reloads or tab visibility changes can affect state.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    debugLog("Page became visible. Re-checking tweets and observer.");
    // Re-run hideTweets to catch anything missed and ensure observer is active.
    hideTweets();
    observeTwitterFeed(); // Re-initialize observer to be safe.
  }
});

// Style for notification animations (added once)
const animationStyle = document.createElement("style");
animationStyle.id = "tweet-hider-animation-styles";
animationStyle.textContent = `
  @keyframes fadeInNotification {
    from { opacity: 0; transform: translateY(-20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeOutNotification {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-20px); }
  }
`;
if (!document.getElementById(animationStyle.id)) {
    document.head.appendChild(animationStyle);
}
