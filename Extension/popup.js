document.addEventListener("DOMContentLoaded", function () {
  // Load saved blocked words and settings
  chrome.storage.sync.get(
    [
      "generalBlockedWords",
      "linkBlockedWords",
      "blockedUsers",
      "enableUserBlocking",
      "autoCollectUsers",
    ],
    function (result) {
      // Load general blocked words
      if (result.generalBlockedWords) {
        document.getElementById("generalBlockedWords").value =
          result.generalBlockedWords.join("\n");
      }

      // Load link blocked words
      if (result.linkBlockedWords) {
        document.getElementById("linkBlockedWords").value =
          result.linkBlockedWords.join("\n");
      }

      // Load blocked users
      if (result.blockedUsers) {
        document.getElementById("blockedUsers").value =
          result.blockedUsers.join("\n");
      }

      // Load user blocking toggle state
      document.getElementById("enableUserBlocking").checked =
        result.enableUserBlocking || false;

      document.getElementById("autoCollectUsers").checked =
        result.autoCollectUsers !== false;
	  
    },
  );

  // Save blocked words when save button is clicked
  document.getElementById("saveButton").addEventListener("click", function () {
    const generalWords = document
      .getElementById("generalBlockedWords")
      .value.split("\n")
      .filter((word) => word.trim() !== "")
      .map((word) => word.trim().toLowerCase());

    const linkWords = document
      .getElementById("linkBlockedWords")
      .value.split("\n")
      .filter((word) => word.trim() !== "")
      .map((word) => word.trim().toLowerCase());

    const blockedUsers = document
      .getElementById("blockedUsers")
      .value.split("\n")
      .filter((user) => user.trim() !== "")
      .map((user) => user.trim().toLowerCase());

    const enableUserBlocking =
      document.getElementById("enableUserBlocking").checked;
    const autoCollect = document.getElementById("autoCollectUsers").checked;

    // Save to storage and force sync
    chrome.storage.sync.set(
      {
        generalBlockedWords: generalWords,
        linkBlockedWords: linkWords,
        blockedUsers: blockedUsers,
        enableUserBlocking: enableUserBlocking,
        autoCollectUsers: autoCollect,
      },
      function () {
        if (chrome.runtime.lastError) {
          showMessage(
            "Error saving: " + chrome.runtime.lastError.message,
            "red",
          );
          return;
        }

        showMessage("Settings saved! Applying to all tabs...", "green");

        // Force sync and refresh all Twitter tabs
        chrome.storage.sync.get(null, (result) => {
          chrome.tabs.query(
            { url: ["https://twitter.com/*", "https://x.com/*"] },
            (tabs) => {
              tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, {
                  action: "forceUpdateBlockLists",
                  data: {
                    generalBlockedWords: result.generalBlockedWords || [],
                    linkBlockedWords: result.linkBlockedWords || [],
                    blockedUsers: result.blockedUsers || [],
                    enableUserBlocking: result.enableUserBlocking || false,
                    autoCollectUsers: result.autoCollectUsers !== false,
                  },
                });
              });
            },
          );
        });
      },
    );
  });

  // Helper function to show messages
  function showMessage(text, color) {
    const saveMsg = document.createElement("div");
    saveMsg.textContent = text;
    saveMsg.style.cssText = `color: ${color}; margin-top: 10px; font-weight: bold; text-align: center;`;

    const oldMsg = document.querySelector(".save-message");
    if (oldMsg) oldMsg.remove();

    saveMsg.className = "save-message";
    document.body.appendChild(saveMsg);

    setTimeout(() => saveMsg.remove(), 3000);
  }
});

// Language translations
const translations = {
  en: {
	title: "Tweet Hider",
	LanguageLabel: "Language ",
    userBlockingLabel: "Hide tweets from these users:",
    generalWordsLabel: "Hide tweets containing:",
    linkWordsLabel: "Hide links containing:",
    saveButton: "Save Settings",
    userPlaceholder:
      "Enter usernames (one per line)\nExample:\nspamuser1\nfakeaccount2",
    generalPlaceholder: "Example:\nnsfw\nporn\nspoiler",
    autoCollect: "Automatically add users who are caught using hidden wordlists",
    statsReset: "Counter resets when you refresh the page.",
    statsRefresh: "Refresh X/Twitter after saving to apply changes.",
    linkPlaceholder: "Example:\ndood\nvidbe\nt.me",
	autoCollectTooltip: "This may also block users based on quoted/retweeted content containing blocked words"
  },
  id: {
	title: "Sembunyikan Tweet",
	LanguageLabel: "Bahasa ",
    userBlockingLabel: "Sembunyikan tweet dari pengguna ini:",
    generalWordsLabel: "Sembunyikan tweet berisi:",
    linkWordsLabel: "Sembunyikan link berisi:",
    saveButton: "Simpan Pengaturan",
    userPlaceholder:
      "Masukkan username (satu per baris)\nContoh:\nspamuser1\nfakeaccount2",
    generalPlaceholder: "Contoh:\nnsfw\nvcs\nspoiler",
    autoCollect:
      "Secara otomatis menambahkan pengguna yang ketahuan menggunakan kata yang disembunyikan",
    statsReset: "Penghitung direset ketika menyegarkan halaman.",
    statsRefresh:
      "Segarkan X/Twitter setelah menyimpan untuk menerapkan perubahan.",
    linkPlaceholder: "Contoh:\ndood\nvidbe\nt.me",
	autoCollectTooltip: "Ini juga dapat memblokir pengguna berdasarkan konten yang dikutip/retweet yang berisi kata-kata yang diblokir"
  },
};

// Load saved language preference
let currentLang = "en"; // Default to English
chrome.storage.sync.get(["language"], (result) => {
  if (result.language) {
    currentLang = result.language;
  }
  updateLanguageUI();
  translateUI();
});

// Language selector click handlers
document.getElementById("lang-en").addEventListener("click", () => {
  if (currentLang !== "en") {
    currentLang = "en";
    chrome.storage.sync.set({ language: currentLang });
    updateLanguageUI();
    translateUI();
  }
});

document.getElementById("lang-id").addEventListener("click", () => {
  if (currentLang !== "id") {
    currentLang = "id";
    chrome.storage.sync.set({ language: currentLang });
    updateLanguageUI();
    translateUI();
  }
});

// Update UI based on selected language
function updateLanguageUI() {
  document
    .getElementById("lang-en")
    .classList.toggle("active", currentLang === "en");
  document
    .getElementById("lang-id")
    .classList.toggle("active", currentLang === "id");
}

// Translate UI elements based on selected language
function translateUI() {
  const t = translations[currentLang];
  
  document.querySelector('h2').textContent = t.title;
  document.getElementById('LanguageLabel').textContent = t.LanguageLabel;
  
  document.getElementById('userBlockingLabel').textContent = t.userBlockingLabel;
  document.getElementById('blockedUsers').placeholder = t.userPlaceholder;
  document.getElementById('generalBlockedWords').placeholder = t.generalPlaceholder;
  document.getElementById('linkBlockedWords').placeholder = t.linkPlaceholder;
  document.getElementById('saveButton').textContent = t.saveButton;
  document.querySelectorAll('.section-title')[0].textContent = t.generalWordsLabel;
  document.querySelectorAll('.section-title')[1].textContent = t.linkWordsLabel;
  document.querySelector("#autoCollectUsersLabel .label-text").textContent = t.autoCollect;
  document.querySelector("#autoCollectUsersLabel .tooltiptext").textContent = t.autoCollectTooltip;
  
  const statsLines = document.querySelectorAll(".stats p");
  statsLines[0].textContent = t.statsReset;
  statsLines[1].textContent = t.statsRefresh;

}

// Update the showMessage function to use translations
function showMessage(text, color) {
  const saveMsg = document.createElement("div");

  // Use translated message if it's the save confirmation
  if (text.includes("Settings saved")) {
    text = translations[currentLang].savedMessage;
  }

  saveMsg.textContent = text;
  saveMsg.style.cssText = `color: ${color}; margin-top: 10px; font-weight: bold; text-align: center;`;

  const oldMsg = document.querySelector(".save-message");
  if (oldMsg) oldMsg.remove();

  saveMsg.className = "save-message";
  document.body.appendChild(saveMsg);

  setTimeout(() => saveMsg.remove(), 3000);
}
