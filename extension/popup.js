document.getElementById("openBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});
