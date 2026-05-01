// Define UI Elements
const authView = document.getElementById('authView');
const codeView = document.getElementById('codeView');
const mainView = document.getElementById('mainView');
const loadingView = document.getElementById('loadingView');

// New view for non-LeetCode pages
const notLeetView = document.getElementById('notLeetView');
const goLeetBtn = document.getElementById('goLeetBtn');

const loginBtn = document.getElementById('authButton') || document.getElementById('login-btn');
const pushBtn = document.getElementById('syncButton') || document.getElementById('push-btn');
const logoutBtn = document.getElementById('logoutButton') || document.getElementById('logout-btn');
const repoBtn = document.getElementById('repoButton');
const copyBtn = document.getElementById('copyButton'); // may be null now
const openGitHubBtn = document.getElementById('openGitHubBtn') || document.getElementById('openGitHubBtn');

const authCodeEl = document.getElementById('authCode') || document.getElementById('auth-code');
const userInfoEl = document.getElementById('userInfo') || document.getElementById('user-info');
const statusEl = document.getElementById('status');

// These elements no longer exist in new UI but references kept for logic safety
const cancelAuthBtn = document.getElementById('cancel-auth');
const authStatusEl = document.getElementById('auth-status');

// State
let currentDeviceCode = null;
let currentVerificationUri = null;
let pollTimeout = null;
let currentFileUrl = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const onLeetCode = tab && tab.url && tab.url.includes('leetcode.com');

    if (!onLeetCode) {
      showNotLeetView();
      // Optional: open leetcode when button clicked
      if (goLeetBtn) {
        goLeetBtn.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { url: 'https://leetcode.com/' });
        });
      }
      return; // stop further init
    }
  } catch (e) {
    // fallback
  }

  await checkAuthStatus();
});

// Check if user is already authenticated
async function checkAuthStatus() {
  try {
    const auth = await githubAuth.loadAuth();
    
    if (auth.github_token && auth.github_username) {
      // Validate token
      const isValid = await githubAuth.validateToken(auth.github_token);
      if (isValid) {
        showLoggedInView(auth);
        return;
      } else {
        // Token expired, clear it
        await githubAuth.clearAuth();
      }
    }
    
    showLoginView();
  } catch (error) {
    showLoginView();
  }
}

// Helpers to toggle views
function hideAllViews() {
  [authView, codeView, mainView, loadingView, notLeetView].forEach(v => v && v.classList.add('hidden'));
}

function showLoginView() {
  hideAllViews();
  if (authView) authView.classList.remove('hidden');
  hideStatus();
}

function showCodeView() {
  hideAllViews();
  if (codeView) codeView.classList.remove('hidden');
}

function showNotLeetView() {
  hideAllViews();
  if (notLeetView) notLeetView.classList.remove('hidden');
  hideStatus();
}

// Setup functions removed - no longer needed with direct authentication

async function showLoggedInView(auth) {
  // Skip setup flow and go directly to main view
  hideAllViews();
  if (mainView) mainView.classList.remove('hidden');

  if (userInfoEl) {
    userInfoEl.textContent = `Logged in as: @${auth.github_username}`;
  }
  
  // Hide repo button initially until a successful push
  if (repoBtn) {
    repoBtn.classList.add('hidden');
  }

  if (copyBtn && authCodeEl) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(authCodeEl.textContent || '').then(() => {
        showStatus('Auth code copied!', 'success');
      });
    };
  }
}

// Show status message
function showStatus(message, type = 'info') {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
  
  // Auto-hide after 5 seconds
  setTimeout(() => hideStatus(), 5000);
}

// Hide status message
function hideStatus() {
  statusEl.classList.add('hidden');
}

// Login button click handler
loginBtn.addEventListener('click', async () => {
  try {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Starting...';
    
    const deviceFlow = await githubAuth.startDeviceFlow();
    
    if (!deviceFlow.user_code) {
      throw new Error('No user code received from GitHub');
    }
    
    currentDeviceCode = deviceFlow.device_code;
    currentVerificationUri = deviceFlow.verification_uri;
    
    // Update UI with the code
    if (authCodeEl) authCodeEl.textContent = deviceFlow.user_code;

    // auto copy to clipboard and notify
    try {
      await navigator.clipboard.writeText(deviceFlow.user_code);
      showStatus('Auth code copied!', 'success');
    } catch(e) { }

    // Switch to main view so code & copy button are visible
    hideAllViews();
    if (codeView) codeView.classList.remove('hidden');

    // Start polling in background script (persists when popup closes)
    chrome.runtime.sendMessage({
      type: 'start-oauth-polling',
      deviceCode: deviceFlow.device_code,
      clientId: githubAuth.getClientId(),
      interval: deviceFlow.interval
    });
    
  } catch (error) {
    showStatus(`Failed to start authentication: ${error.message}`, 'error');
    showLoginView();
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Connect to GitHub';
  }
});

// Cancel auth button click handler
if (cancelAuthBtn) {
  cancelAuthBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'stop-oauth-polling' });
    currentDeviceCode = null;
    currentVerificationUri = null;
    showLoginView();
  });
}

// Open GitHub button click handler
if (openGitHubBtn) {
  openGitHubBtn.addEventListener('click', () => {
    if (currentVerificationUri) {
      chrome.tabs.create({ url: currentVerificationUri });
    }
  });
}

// Logout button click handler
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  await githubAuth.clearAuth();
  currentFileUrl = null;
  if (repoBtn) {
    repoBtn.classList.add('hidden');
  }
  showLoginView();
  showStatus('Successfully logged out', 'info');
});

// Push button click handler
if (pushBtn) pushBtn.addEventListener('click', async () => {
  
  try {
    pushBtn.disabled = true;
    pushBtn.textContent = 'Pushing...';
    showStatus('extracting code...', 'info');
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const currentUrl = tabs[0].url || '';

    // Require LeetCode problem page
    if (!currentUrl.includes('leetcode.com')) {
      showStatus('Go to LeetCode first', 'error');
      return;
    }

    if (!/leetcode\.com\/problems\//.test(currentUrl)) {
      showStatus('Open a specific LeetCode problem page before pushing', 'error');
      return;
    }
    
    // First, try to clear any cached scripts by reloading the page content
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        func: () => {
          // Just a simple script to verify injection works
        }
      });
    } catch (e) {
    }
    

    const [{ result: extraction }] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: 'MAIN',
      func: () => {
        
        const debug = [];
        let extractedCode = "";
        let method = "";

        function detectLanguage(code) {
          const clean = (code || "").toLowerCase();
          if (/class\s+solution\s*:/i.test(code) || /def\s+\w+\s*\(/.test(code)) return 'python';
          if (/public\s+class/.test(code)) return 'java';
          if (/function\s+\w+\s*\(/.test(code)) return 'javascript';
          if (/#include\s*</.test(code)) return 'cpp';
          return 'python';
        }

        // 1) Monaco
        try {
          if (window.monaco && window.monaco.editor) {
            const models = window.monaco.editor.getModels();
            debug.push('monaco models:' + models.length);
            for (const m of models) {
              const val = m.getValue();
              if (val && val.length > extractedCode.length) { extractedCode = val; method = 'Monaco'; }
            }
          }
        } catch (e) { debug.push('monaco error:' + e.message); }

        // 2) Textareas
        if (!extractedCode) {
          const tArr = Array.from(document.querySelectorAll('textarea'));
          debug.push('textareas:' + tArr.length);
          tArr.forEach((ta, idx) => {
            const v = ta.value || '';
            if (v.length > extractedCode.length) { extractedCode = v; method = 'Textarea #' + idx; }
          });
        }

        // 3) CodeMirror
        if (!extractedCode && window.CodeMirror) {
          try {
            const cmEls = Array.from(document.querySelectorAll('.CodeMirror'));
            debug.push('codemirror elements:' + cmEls.length);
            cmEls.forEach((el, idx) => {
              if (el.CodeMirror && el.CodeMirror.getValue) {
                const val = el.CodeMirror.getValue();
                if (val.length > extractedCode.length) { extractedCode = val; method = 'CodeMirror #' + idx; }
              }
            });
          } catch (e) { debug.push('cm error:' + e.message); }
        }

        // 4) DOM text fallback
        if (!extractedCode) {
          const candidates = Array.from(document.querySelectorAll('[class*="editor"], [id*="editor"], pre code'));
          debug.push('editor-like elements:' + candidates.length);
          candidates.forEach((el, idx) => {
            const txt = el.textContent || '';
            if (txt.trim().length > extractedCode.length) { extractedCode = txt.trim(); method = 'DOM text #' + idx; }
          });
        }

        return {
          ok: !!extractedCode,
          code: (extractedCode || '').trim(),
          language: detectLanguage(extractedCode),
          method,
          debug
        };
      }
    });

    if (!extraction || !extraction.ok) {
      showStatus('Failed to extract code. Please ensure the code editor is visible.', 'error');
      return;
    }

    await pushToGitHub(extraction.code, tabs[0].url, extraction.language);
    
  } catch (error) {
    showStatus(`Failed to push code: ${error.message}`, 'error');
  } finally {
    pushBtn.disabled = false;
    pushBtn.textContent = 'PUSH TO GITHUB';
  }
});

// Listen for messages from content script and background script
chrome.runtime.onMessage.addListener(async (request, sender) => {
  
  if (request.type === "leetcode-code-v5") {
    await pushToGitHub(request.code, request.url, request.language);
  } else if (request.type === "leetcode-code") {
    await pushToGitHub(request.code, request.url, request.language);
  } else if (request.type === "error-v5") {
    showStatus(request.message, 'error');
    
    // Re-enable push button on error
    const pushBtn = document.getElementById('push-btn');
    if (pushBtn) {
      pushBtn.disabled = false;
      pushBtn.textContent = 'PUSH TO GITHUB';
    }
  } else if (request.type === "auth-complete") {
    
    // Update auth status
    if (authStatusEl) {
      authStatusEl.textContent = "✅ Authentication successful!";
      authStatusEl.className = "status success";
    }
    
    // Wait a moment for background script to save auth data, then reload from storage
    setTimeout(async () => {
      const auth = await githubAuth.loadAuth();
      if (auth.github_token && auth.github_username) {
        showLoggedInView(auth);
        showStatus('Successfully authenticated with GitHub!', 'success');
      } else {
        // Fallback if storage hasn't been updated yet
        showLoggedInView({
          github_token: request.token,
          github_username: request.userInfo.login,
          github_user_info: request.userInfo
        });
        showStatus('Successfully authenticated with GitHub!', 'success');
      }
    }, 1500);
  } else if (request.type === "error") {
    showStatus(request.message, 'error');
    
    // Re-enable push button on error
    const pushBtn = document.getElementById('push-btn');
    if (pushBtn) {
      pushBtn.disabled = false;
      pushBtn.textContent = 'PUSH TO GITHUB';
    }
  }
});

// Auto-create repository if it doesn't exist
async function ensureRepositoryExists(token, username, repoName) {
  const repoUrl = `https://api.github.com/repos/${username}/${repoName}`;
  
  try {
    const response = await fetch(repoUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Leet2Git-Extension"
      }
    });
    
    if (response.ok) {
      return true;
    }
    
    if (response.status === 404) {
      
      const createResponse = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "Leet2Git-Extension"
        },
        body: JSON.stringify({
          name: repoName,
          description: "LeetCode solutions automatically synced from Leet2Git extension - https://Leet2Git.in/",
          private: false,
          auto_init: true
        })
      });
      
      if (createResponse.ok) {
        showStatus(`Created repository: ${username}/${repoName}`, 'success');
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

// Push code to GitHub
async function pushToGitHub(code, url, language = 'python') {
  try {
    
    const auth = await githubAuth.loadAuth();
    if (!auth.github_token || !auth.github_username) {
      showStatus('Please authenticate with GitHub first', 'error');
      return;
    }
    
    const slug = getProblemSlug(url);
    const fileExtension = getFileExtension(language);
    const fileName = `${slug}.${fileExtension}`;
    const path = `leetcode/${fileName}`;
    const repoName = "code-sync";
    const username = auth.github_username;
    
    // Store the direct file URL for the repo button
    currentFileUrl = `https://github.com/${username}/${repoName}/blob/main/${path}`;
    
    // Ensure repository exists (create if it doesn't)
    const repoExists = await ensureRepositoryExists(auth.github_token, username, repoName);
    if (!repoExists) {
      showStatus('Failed to create or access repository', 'error');
      return;
    }
    
    // Use user's token for repository operations
    const apiUrl = `https://api.github.com/repos/${username}/${repoName}/contents/${path}`;
    const contentB64 = btoa(unescape(encodeURIComponent(code)));

    // Check if file already exists to get its SHA
    const checkResponse = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${auth.github_token}`,
        "User-Agent": "Leet2Git-Extension"
      }
    });

    let sha = null;
    let exists = false;
    if (checkResponse.ok) {
      const data = await checkResponse.json();
      sha = data.sha;
      exists = true;
    } else if (checkResponse.status !== 404) {
      const errorData = await checkResponse.json();
      showStatus(`GitHub API error: ${errorData.message}`, 'error');
      return;
    }

    // Create commit message
    const commitMessage = exists ? 
      `Update solution for ${slug}` : 
      `Add solution for ${slug}`;
      
    const body = {
      message: commitMessage,
      content: contentB64,
      branch: 'main',
      ...(exists ? { sha } : {})
    };

    const putResponse = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.github_token}`,
        "Content-Type": "application/json",
        "User-Agent": "Leet2Git-Extension"
      },
      body: JSON.stringify(body)
    });

    const result = await putResponse.json();
    if (result.content) {
      showStatus('Successfully pushed to GitHub!', 'success');
      // Show the repo button after successful push
      if (repoBtn) {
        repoBtn.classList.remove('hidden');
      }
    } else {
      showStatus(`Failed to push: ${result.message || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showStatus('Network error occurred', 'error');
  }
}

// Helper to extract problem slug from URL
function getProblemSlug(url) {
  const match = url.match(/leetcode\.com\/problems\/([^\/]+)/);
  return match ? match[1] : 'solution';
}

// Map language to file extension
function getFileExtension(language) {
  const map = {
    python: 'py',
    java: 'java',
    javascript: 'js',
    typescript: 'ts',
    cpp: 'cpp',
    c: 'c',
    go: 'go',
    rust: 'rs',
    kotlin: 'kt',
    swift: 'swift'
  };
  return map[language] || 'txt';
}

// Repo button click handler
if (repoBtn) {
  repoBtn.addEventListener('click', () => {
    if (currentFileUrl) {
      chrome.tabs.create({ url: currentFileUrl });
    }
  });
}