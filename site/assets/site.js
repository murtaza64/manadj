// Light up the top-bar segment for the chapter in view. Progressive
// enhancement only: the page is complete without it.
const segments = new Map(
  [...document.querySelectorAll('.segment[data-target]')].map((a) => [a.dataset.target, a]),
);
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const a of segments.values()) a.classList.remove('active');
      if (entry.target.id === 'hero') {
        document.querySelector('.segments').scrollLeft = 0;
        continue;
      }
      const seg = segments.get(entry.target.id);
      if (seg) {
        seg.classList.add('active');
        const bar = seg.parentElement;
        if (seg.offsetLeft < bar.scrollLeft || seg.offsetLeft + seg.offsetWidth > bar.scrollLeft + bar.clientWidth) {
          bar.scrollLeft = seg.offsetLeft - bar.clientWidth / 2;
        }
      }
    }
  },
  { rootMargin: '-45% 0px -50% 0px' },
);
for (const id of ['hero', ...segments.keys()]) {
  const el = document.getElementById(id);
  if (el) observer.observe(el);
}
