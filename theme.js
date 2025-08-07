const toggleBtn = document.getElementById("themeToggle");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const newTheme = current === "dark" ? "light" : "dark";
  setTheme(newTheme);
}

function loadInitialTheme() {
  const saved = localStorage.getItem("theme");
  if (saved) {
    setTheme(saved);
  } else if (prefersDark.matches) {
    setTheme("dark");
  } else {
    setTheme("light");
  }
}

// Load theme on page load
loadInitialTheme();

// Add event listener to toggle
toggleBtn?.addEventListener("click", toggleTheme);