chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "IS_LEETCODE_PROBLEM") {
    const isProblem = window.location.pathname.startsWith("/problems/");
    sendResponse({ isProblem });
  }
});
