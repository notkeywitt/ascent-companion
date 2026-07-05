const DEFAULT_URL = "http://localhost:3000";
const K_URL = "ascentCompanionUrl";
const K_FOLLOW = "ascentFollow";
const K_JOB = "ascentCurrentJob";

const urlInput = document.getElementById("url");
const goBtn = document.getElementById("go");
const followChk = document.getElementById("follow");
const jobLabel = document.getElementById("job");
const frame = document.getElementById("frame");

let appUrl = DEFAULT_URL;
let follow = true;
let lastLoadedJob = null;

function loadUrl(u) {
  if (frame.src !== u) frame.src = u;
}
function loadJob(jobId) {
  lastLoadedJob = jobId;
  loadUrl(`${appUrl.replace(/\/$/, "")}/?jobId=${encodeURIComponent(jobId)}`);
}
function loadHome() {
  lastLoadedJob = null;
  loadUrl(appUrl);
}
function setJobLabel(jobId) {
  if (jobId) {
    jobLabel.textContent = "▶ " + jobId;
    jobLabel.classList.remove("none");
  } else {
    jobLabel.textContent = "no job open";
    jobLabel.classList.add("none");
  }
}

// Initial state
chrome.storage.local.get([K_URL, K_FOLLOW, K_JOB], (d) => {
  appUrl = d[K_URL] || DEFAULT_URL;
  follow = d[K_FOLLOW] !== false; // default on
  urlInput.value = appUrl;
  followChk.checked = follow;
  const jobId = d[K_JOB] && d[K_JOB].jobId;
  setJobLabel(jobId);
  if (follow && jobId) loadJob(jobId);
  else loadHome();
});

// React to the content script publishing a new job, or a url change elsewhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[K_JOB]) {
    const jobId = changes[K_JOB].newValue && changes[K_JOB].newValue.jobId;
    setJobLabel(jobId);
    if (follow && jobId && jobId !== lastLoadedJob) loadJob(jobId);
  }
  if (changes[K_URL]) {
    appUrl = changes[K_URL].newValue || DEFAULT_URL;
    urlInput.value = appUrl;
  }
});

// Controls
function saveUrl() {
  appUrl = (urlInput.value || "").trim() || DEFAULT_URL;
  chrome.storage.local.set({ [K_URL]: appUrl });
  if (follow && lastLoadedJob) loadJob(lastLoadedJob);
  else loadHome();
}
goBtn.addEventListener("click", saveUrl);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveUrl();
});

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
