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

// Export block lists to JSON file
function exportBlockLists() {
  chrome.storage.sync.get(
    [
      "generalBlockedWords",
      "linkBlockedWords",
      "blockedUsers",
      "enableUserBlocking",
    ],
    function (result) {
      const data = {
        version: 1,
        generalWords: result.generalBlockedWords || [],
        linkWords: result.linkBlockedWords || [],
        users: result.blockedUsers || [],
        userBlockingEnabled: result.enableUserBlocking || false,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "twitter_blocker_export.json";
      a.click();

      URL.revokeObjectURL(url);
      showMessage("Block lists exported successfully!", "green");
    },
  );
}

// Import block lists from JSON file
function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);

      // Validate the imported data
      if (!data.version || data.version !== 1) {
        throw new Error("Invalid file format");
      }

      // Update UI with imported data
      document.getElementById("generalBlockedWords").value = (
        data.generalWords || []
      ).join("\n");
      document.getElementById("linkBlockedWords").value = (
        data.linkWords || []
      ).join("\n");
      document.getElementById("blockedUsers").value = (data.users || []).join(
        "\n",
      );
      document.getElementById("enableUserBlocking").checked =
        data.userBlockingEnabled || false;

      showMessage("Block lists imported successfully!", "green");
    } catch (err) {
      showMessage("Error importing file: " + err.message, "red");
    }
  };
  reader.readAsText(file);
}
