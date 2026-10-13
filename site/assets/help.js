// Collapse the article directory on narrow screens; native details owns toggling.
// No keyboard interception: the embedding app handles its own shortcuts.
if (window.matchMedia('(max-width: 760px)').matches) {
  document.querySelector('.help-navigation').open = false;
}
