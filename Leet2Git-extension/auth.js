// GitHub Device Flow OAuth
// This provides a user-friendly way to authenticate without client secrets

class GitHubAuth {
  constructor() {
    this.clientId = "Ov23lipKhJX1kFnQLgQ9";
    this.deviceCodeUrl = "https://github.com/login/device/code";
    this.tokenUrl = "https://github.com/login/oauth/access_token";
  }

  // Getter for clientId
  getClientId() {
    return this.clientId;
  }

  // Start the OAuth device flow
  async startDeviceFlow() {
    // Check if client ID is configured
    if (!this.clientId || this.clientId === "YOUR_GITHUB_OAUTH_CLIENT_ID") {
      throw new Error("GitHub OAuth Client ID not configured. Please follow the setup instructions in README.md");
    }

    // Check if we have the necessary permissions
    try {
      const hasPermissions = await chrome.permissions.contains({
        origins: ["https://github.com/*"]
      });
      
      if (!hasPermissions) {
        const granted = await chrome.permissions.request({
          origins: ["https://github.com/*"]
        });
        
        if (!granted) {
          throw new Error("GitHub permissions not granted. Please allow access to GitHub.");
        }
      }
    } catch (permError) {
      // Continue anyway - might be in development mode
    }

    try {
      const response = await fetch(this.deviceCodeUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `client_id=${this.clientId}&scope=public_repo`
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      // Check if we got an error in the response
      if (data.error) {
        throw new Error(`GitHub error: ${data.error_description || data.error}`);
      }
      
      // Validate that we got all required fields
      if (!data.device_code || !data.user_code || !data.verification_uri) {
        throw new Error("Invalid response from GitHub: missing required fields");
      }

      return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval
      };
    } catch (error) {
      throw error;
    }
  }

  // Poll for the access token
  async pollForToken(deviceCode, interval = 5) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const response = await fetch(this.tokenUrl, {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${this.clientId}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
          });

          const data = await response.json();

          if (data.access_token) {
            resolve(data.access_token);
          } else if (data.error === "authorization_pending") {
            setTimeout(poll, interval * 1000);
          } else if (data.error === "slow_down") {
            setTimeout(poll, (interval + 5) * 1000);
          } else {
            reject(new Error(data.error_description || data.error));
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  // Get user info using the token
  async getUserInfo(token) {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "dotpush-Extension"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Save token and user info to Chrome storage
  async saveAuth(token, userInfo) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({
        github_token: token,
        github_username: userInfo.login,
        github_user_info: userInfo
      }, resolve);
    });
  }

  // Load saved authentication
  async loadAuth() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['github_token', 'github_username', 'github_user_info'], resolve);
    });
  }

  // Clear saved authentication
  async clearAuth() {
    return new Promise((resolve) => {
      chrome.storage.sync.remove(['github_token', 'github_username', 'github_user_info'], resolve);
    });
  }

  // Check if token is still valid
  async validateToken(token) {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "dotpush-Extension"
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Global auth instance
const githubAuth = new GitHubAuth(); 