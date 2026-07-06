// Deployed companion app. Change here if the deploy URL ever changes.
const APP_URL = "https://ascent-companion.vercel.app";

const K_FOLLOW = "ascentFollow";
const K_JOB = "ascentCurrentJob";

const followChk = document.getElementById("follow");
const jobLabel = document.getElementById("job");
const frame = document.getElementById("frame");

let follow = true;
let lastLoadedJob = null;

function loadUrl(u) {
  if (frame && frame.src !== u) frame.src = u;
}
function loadJob(jobId) {
  lastLoadedJob = jobId;
  loadUrl(`${APP_URL}/?jobId=${encodeURIComponent(jobId)}`);
}
function loadHome() {
  lastLoadedJob = null;
  loadUrl(APP_URL);
}
function setJobLabel(jobId) {
  if (!jobLabel) return;
  jobLabel.textContent = jobId ? "▶ " + jobId : "no job open";
  jobLabel.classList.toggle("none", !jobId);
}

// Initial state
chrome.storage.local.get([K_FOLLOW, K_JOB], (d) => {
  follow = d[K_FOLLOW] !== false; // default on
  if (followChk) followChk.checked = follow;
  const jobId = d[K_JOB] && d[K_JOB].jobId;
  setJobLabel(jobId);
  if (follow && jobId) loadJob(jobId);
  else loadHome();
});

// React to the content script publishing a new job.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[K_JOB]) {
    const jobId = changes[K_JOB].newValue && changes[K_JOB].newValue.jobId;
    setJobLabel(jobId);
    if (follow && jobId && jobId !== lastLoadedJob) loadJob(jobId);
  }
});

if (followChk) {
  followChk.addEventListener("change", () => {
    follow = followChk.checked;
    chrome.storage.local.set({ [K_FOLLOW]: follow });
    if (follow) {
      chrome.storage.local.get(K_JOB, (d) => {
        const jobId = d[K_JOB] && d[K_JOB].jobId;
        if (jobId && jobId !== lastLoadedJob) loadJob(jobId);
      });
    }
  });
}

// The companion app (in the iframe) can ask us to open a JobTread document in
// the main browser tab the panel is docked next to — e.g. clicking a bill in the
// coding queue brings that bill up in JobTread beside the panel. Prefer the
// active tab; fall back to any JobTread tab.
window.addEventListener("message", (e) => {
  if (e.origin !== APP_URL) return;
  const d = e.data || {};

  // Navigate the docked JobTread tab to a specific document.
  if (d.type === "ascentOpenJtDoc" && d.href) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (t && /:\/\/app\.jobtread\.com\//.test(t.url || "")) {
        chrome.tabs.update(t.id, { url: d.href });
      } else {
        chrome.tabs.query({ url: "https://app.jobtread.com/*" }, (jt) => {
          if (jt && jt.length) chrome.tabs.update(jt[0].id, { url: d.href, active: true });
        });
      }
    });
    return;
  }

  // Reload the docked JobTread tab so it shows a change the companion just wrote.
  if (d.type === "ascentReloadJt") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (t && /:\/\/app\.jobtread\.com\//.test(t.url || "")) {
        chrome.tabs.reload(t.id);
      } else {
        chrome.tabs.query({ url: "https://app.jobtread.com/*" }, (jt) => {
          if (jt && jt.length) chrome.tabs.reload(jt[0].id);
        });
      }
    });
    return;
  }
});
