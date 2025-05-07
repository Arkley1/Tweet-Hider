# Tweet Hider Extension

## Description
Tweet Hider is a Chrome extension designed to give you more control over your Twitter (X) experience by automatically hiding unwanted tweets. Whether it's tweets from certain users or tweets containing specific words (either in the text or within links), this extension makes your feed cleaner and more tailored to your interests.

## Prerequisites
- A Chromium-based browser (such as Google Chrome, Microsoft Edge, or Opera)

## Download
<a href="https://github.com/Arkley1/Tweet-Hider/releases" target="_blank"><b>Download latest build</b></a>

## Installation
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `extension` directory from this project.
4. Once loaded, the extension icon will appear in your Chrome toolbar.

## Features
- **User-Based Filtering:** Automatically hide all tweets from users whose usernames are listed in your filter.
- **Keyword Filtering:** Automatically hide tweets that contain any word from your specified word list.
- **Link Content Filtering:** Automatically hide tweets if any word from your word list appears within the URLs or links they contain.
- **Dynamic Filtering:** Automatically add a username to your filter list when a tweet is hidden due to your filter rules.

## Usage
1. Click the extension icon in your Chrome toolbar to open the popup interface.
2. Toggle the options to enable/disable filtering by username and automatic user addition:
   - **Username Filter Toggle:** Enable or disable filtering based on the username list.
   - **Dynamic Addition Toggle:** Enable or disable the automatic addition of users when their tweets are hidden.
3. Enter the usernames and keywords/phrases you want to filter, then click **Save** to apply your settings.
4. Refresh your Twitter (X) page.
5. Browse Twitter as usual—the extension will automatically filter out tweets based on your criteria.

## Configuration
You can update your lists directly in the extension’s settings:
- **Usernames List:** Add or remove usernames whose tweets you want to avoid.
- **Word List:** Input keywords that should trigger a tweet to be hidden, whether they appear in tweet text or within links.


## Contributing
Contributions are welcome! If you'd like to help improve Tweet Filter, please open an issue or submit a pull request to discuss changes and improvements.
