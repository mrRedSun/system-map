// Apply the saved theme before first paint (external file so the CSP needs no inline scripts).
(function () {
  var theme = 'system';
  try {
    theme = localStorage.getItem('system-map:theme') || 'system';
  } catch (e) {}
  var dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
