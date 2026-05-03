// Background script for Leet2Git Extension
// Handles OAuth authentication polling that persists when popup closes

class BackgroundAuth {
  constructor() {
    this.polling = false;
    this.pollInterval = null;
  }

  // Start polling for OAuth token in background
  async startPolling(deviceCode, clientId, interval = 5) {
    if (this.polling) {
      this.stopPolling();
    }

    this.polling = true;

    const poll = async () => {
      if (!this.polling) return;

      try {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: `client_id=${clientId}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
        });

        const data = await response.json();

        if (data.access_token) {
          
          // Get user info
          const userResponse = await fetch("https://api.github.com/user", {
            headers: {
              "Authorization": `Bearer ${data.access_token}`,
              "User-Agent": "dotpush-Extension"
            }
          });
          
          if (userResponse.ok) {
            const userInfo = await userResponse.json();
            
            // Auto-create leetcode-sync repository
            await this.createLeetCodeRepository(data.access_token, userInfo.login);
            
            // Save authentication
            await chrome.storage.sync.set({
              github_token: data.access_token,
              github_username: userInfo.login,
              github_user_info: userInfo
            });
            
            // Notify popup if it's open
            this.notifyAuthComplete(data.access_token, userInfo);
          }
          
          this.stopPolling();
        } else if (data.error === "authorization_pending") {
          this.pollInterval = setTimeout(poll, interval * 1000);
        } else if (data.error === "slow_down") {
          this.pollInterval = setTimeout(poll, (interval + 5) * 1000);
        } else {
          this.stopPolling();
        }
      } catch (error) {
        this.stopPolling();
      }
    };

    // Start polling immediately
    poll();
  }

  stopPolling() {
    this.polling = false;
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // Notify popup of completed authentication
  notifyAuthComplete(token, userInfo) {
    // Send message to popup if it's listening
    chrome.runtime.sendMessage({
      type: 'auth-complete',
      token: token,
      userInfo: userInfo
    }).catch(() => {
      // Popup might be closed, that's OK
    });
  }

  async createLeetCodeRepository(token, username) {
    const repoName = "leet2git";
    const repoUrl = `https://api.github.com/repos/${username}/${repoName}`;
    
    try {
      // Check if repository already exists
      const checkResponse = await fetch(repoUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "dotpush-Extension"
        }
      });
      
      if (checkResponse.ok) {
        return true;
      }
      
      if (checkResponse.status === 404) {
        
        const createResponse = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "dotpush-Extension"
          },
          body: JSON.stringify({
            name: repoName,
            description: "Coding solutions automatically synced from Leet2Git",
            private: false,
            auto_init: true
          })
        });
        
        if (createResponse.ok) {
          return true;
        } else {
          const errorData = await createResponse.json();
          return false;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
}

const backgroundAuth = new BackgroundAuth();

// Icon management for LeetCode page detection
class IconManager {
  constructor() {
    this.activeIconPaths = {
      "16": "icons/icon-128.png",
      "32": "icons/icon-128.png", 
      "48": "icons/icon-128.png",
      "128": "icons/icon-128.png"
    };
    
    this.inactiveIconPaths = {
      "16": "icons/inactive-128.png",
      "32": "icons/inactive-128.png",
      "48": "icons/inactive-128.png", 
      "128": "icons/inactive-128.png"
    };
  }

  // Update icon based on current tab
  async updateIcon(tabId, url) {
    const isLeetCode = url && url.includes('leetcode.com');
    
    try {
      await chrome.action.setIcon({
        tabId: tabId,
        path: isLeetCode ? this.activeIconPaths : this.inactiveIconPaths
      });
      
      // Update title to reflect state
      await chrome.action.setTitle({
        tabId: tabId,
        title: isLeetCode ? 
          "dotpush - Ready to sync!" : 
          "dotpush - Navigate to LeetCode"
      });
    } catch (error) {
      // Ignore errors in production
    }
  }
}

const iconManager = new IconManager();

// Listen for tab updates to change icon state
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only update when the page has finished loading or URL changed
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await iconManager.updateIcon(tabId, tab.url);
  }
});

// Listen for tab activation (when user switches tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await iconManager.updateIcon(activeInfo.tabId, tab.url);
  } catch (error) {
    // Ignore errors in production
  }
});

// Set initial icon state when extension starts
chrome.runtime.onStartup.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await iconManager.updateIcon(tabs[0].id, tabs[0].url);
    }
  } catch (error) {
    // Ignore errors in production
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'start-oauth-polling') {
    backgroundAuth.startPolling(request.deviceCode, request.clientId, request.interval);
    sendResponse({ success: true });
  } else if (request.type === 'stop-oauth-polling') {
    backgroundAuth.stopPolling();
    sendResponse({ success: true });
  }
  
  return true; // Keep message channel open
}); 