// Runs on JobTread. Reads the current job id (and document id) from the URL and
// publishes it to chrome.storage so the side panel can follow along. JobTread is
// a SPA, so the URL changes without a page reload — poll + popstate covers it.
//
// URL shape: https://app.jobtread.com/jobs/<jobId>/documents/<docId>
const JOB_RE = /\/jobs\/([A-Za-z0-9]+)/;
const DOC_RE = /\/documents\/([A-Za-z0-9]+)/;

let lastHref = "";

function detect() {
  const href = location.href;
  if (href === lastHref) return;
  lastHref = href;
  const jobId = (href.match(JOB_RE) || [])[1] || "";
  const docId = (href.match(DOC_RE) || [])[1] || "";
  try {
    chrome.storage.local.set({ ascentCurrentJob: { jobId, docId, href } });
  } catch (e) {
    // extension context can be invalidated on reload — ignore
  }
}

detect();
setInterval(detect, 700);
window.addEventListener("popstate", detect);
