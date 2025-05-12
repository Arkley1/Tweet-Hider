let generalBlockedWords = [];
let notificationTimeout;
let linkBlockedWords = [];
let blockedUsers = [];
let enableUserBlocking = false;
let debugMode = true; // For output console log
let hiddenTweetCount = 0;
let autoCollectUsers = true;
let collectedUsers = []; // Track users we've found

const hiddenTweetIds = new Set();

const SELECTORS = {
  TWEET: 'article[data-testid="tweet"], div[data-testid="tweet"]',
  USERNAME: '[data-testid="User-Name"] a[href^="/"]',
  TWEET_TEXT: 'div[data-testid="tweetText"], div[lang]:has(> span)',
  LINKS: 'a[href]'
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
  const tweets = document.querySelectorAll(`
    article[data-testid="tweet"]:not([data-tweet-hidden="true"]),
    div[data-testid="tweet"]:not([data-tweet-hidden="true"])
  `);

  if (!tweets.length) return;

  let newlyHidden = 0;
  const currentHiddenIds = new Set();

  // Process in batches with proper tracking
  const processBatch = (start, end) => {
    for (let i = start; i < end; i++) {
      const tweet = tweets[i];
      const tweetId = tweet.getAttribute('data-tweet-id') || 
                     tweet.querySelector('a[href*="/status/"]')?.href.split('/').pop();

      // Skip if already hidden in this run or previous runs
      if (!tweetId || hiddenTweetIds.has(tweetId)) continue;

      if (shouldHideTweet(tweet)) {
        tweet.style.display = "none";
        tweet.setAttribute('data-tweet-hidden', 'true');
        hiddenTweetIds.add(tweetId);
        newlyHidden++;
        currentHiddenIds.add(tweetId);
      }
    }

    if (end < tweets.length) {
      requestAnimationFrame(() => processBatch(end, Math.min(end + 5, tweets.length)));
    } else {
      if (newlyHidden > 0) {
        hiddenTweetCount += newlyHidden;
        updateCounterDisplay();
      }
      // Clean up old IDs that are no longer in DOM
      cleanupHiddenIds(currentHiddenIds);
    }
  };

  processBatch(0, Math.min(5, tweets.length));
}

function cleanupHiddenIds(currentIds) {
  // Remove IDs of tweets that are no longer in DOM
  for (const id of hiddenTweetIds) {
    if (!currentIds.has(id) && !document.querySelector(`[data-tweet-id="${id}"]`)) {
      hiddenTweetIds.delete(id);
    }
  }
}

function shouldHideTweet(tweet) {
  // Combined check with early returns
  return shouldHideByUsername(tweet) || 
         shouldHideByGeneralWords(tweet) || 
         shouldHideByLinkWords(tweet);
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

  // Cache the tweet's user element once per tweet
  const userElement = tweet.querySelector('[data-testid="User-Name"]');
  if (!userElement) return false;

  // Get username from pre-queried element
  const usernameLink = userElement.querySelector('a[href^="/"]');
  if (!usernameLink) return false;

  const href = usernameLink.getAttribute("href");
  const username = href.split("/")[1]?.toLowerCase();
  
  if (username && blockedUsers.includes(username)) {
    debugLog(`Hiding tweet from blocked user: ${username}`);
    return true;
  }

  return false;
}

// Filter by General wordlist
function shouldHideByGeneralWords(tweet) {
  if (generalBlockedWords.length === 0) return false;

  // Single query for all text elements
  const textElements = tweet.querySelectorAll('div[data-testid="tweetText"], div[lang]:has(> span)');
  if (!textElements.length) return false;

  // Combine text once
  const combinedText = Array.from(textElements)
    .map(el => el.textContent || "")
    .join(" ")
    .toLowerCase();

  // Pre-process blocked words
  const blockedTerms = generalBlockedWords.map(w => w.toLowerCase());

  // Single check against all terms
  if (blockedTerms.some(term => combinedText.includes(term))) {
    const username = getUsernameFromTweet(tweet);
    debugLog(`Hiding tweet containing blocked term in post by @${username}`);
    
    if (autoCollectUsers && username) {
      collectUserFromTweet(tweet);
    }
    return true;
  }

  return false;
}

// Filter by link wordlist
function shouldHideByLinkWords(tweet) {
  if (linkBlockedWords.length === 0) return false;

  // Cache all links once per tweet
  const links = tweet.querySelectorAll("a[href]");
  if (!links.length) return false;

  // Pre-process blocked words once
  const blockedDomains = linkBlockedWords.map(w => w.toLowerCase());

  for (const link of links) {
    const href = (link.getAttribute("href") || "").toLowerCase();

    // Skip Twitter links early
    if (href.startsWith("/") || 
        href.includes("twitter.com") || 
        href.includes("x.com") ||
        href.startsWith("#") || 
        href.startsWith("@")) {
      continue;
    }

    try {
      const url = new URL(href.startsWith("http") ? href : `https://${href}`);
      const domain = url.hostname.replace("www.", "");

      // Check against pre-processed domains
      if (blockedDomains.some(blocked => domain.includes(blocked))) {
        const username = getUsernameFromTweet(tweet);
        debugLog(`Found blocked link domain "${url}" from @${username}`);
        
        if (autoCollectUsers && username) {
          collectUserFromTweet(tweet);
        }
        return true;
      }
    } catch (e) {
      debugLog("Error parsing URL:", href, e);
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
      'div[data-testid="primaryColumn"]'
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
    debugLog('Tweet container not found, retrying...');
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
      const needsCheck = mutations.some(mutation => {
        return (mutation.addedNodes && mutation.addedNodes.length > 0) ||
               (mutation.type === 'attributes' && mutation.attributeName === 'aria-label');
      });
      
      if (needsCheck) {
        debugLog('Processing mutations...');
        hideTweets();
      }
    }, 100);
  };
  
  const observer = new MutationObserver((mutations) => {
    const hasNewTweets = mutations.some(mutation => {
      return Array.from(mutation.addedNodes || []).some(node => {
        return node.nodeType === 1 && (
          node.matches('[data-testid="tweet"]') ||
          node.querySelector('[data-testid="tweet"]')
        );
      });
    });

    if (hasNewTweets) {
      hideTweets();
    }
  });
  
  currentObserver = new MutationObserver(handleMutations);
  currentObserver.observe(tweetContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-label']
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
    subtree: true
  });

  //debugLog('Observer initialized for current view');
  hideTweets(); // Initial check
}

// Add periodic check for view changes
setInterval(() => {
  const currentContainer = document.querySelector('div[data-testid="primaryColumn"] section[role="region"]');
  if (currentContainer && !currentContainer.isConnected) {
    //debugLog('Container disconnected, reinitializing...');
    observeTwitterFeed();
  }
}, 2000);

// Initialize
observeTwitterFeed();

// Reset when page becomes visible
document.addEventListener('visibilitychange', () => {
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
    subtree: true
  });
}

// Initialize everything
function initObserver() {
  observeTwitterFeed();
  handleSPANavigation();
  
  // Reset when page becomes visible again
  document.addEventListener('visibilitychange', () => {
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
