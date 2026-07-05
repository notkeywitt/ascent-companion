const DEFAULT_URL = "http://localhost:3000";
const STORAGE_KEY = "ascentCompanionUrl";

const input = document.getElementById("url");
const frame = document.getElementById("frame");
const go = document.getElementById("go");

function load(url) {
  frame.src = url;
}

chrome.storage.local.get(STORAGE_KEY, (data) => {
  const url = data[STORAGE_KEY] || DEFAULT_URL;
  input.value = url;
  load(url);
});

go.addEventListener("click", save);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});

function save() {
  const url = input.value.trim() || DEFAULT_URL;
  chrome.storage.local.set({ [STORAGE_KEY]: url });
  load(url);
}
