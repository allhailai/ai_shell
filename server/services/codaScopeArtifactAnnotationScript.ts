/* ── CodaScope: Artifact Annotation Script ───────────────────────────
   Injectable JavaScript for iframe DOM inspection overlay.

   Ported from KissAI's annotationScript.js. This module exports a
   function that returns the <script> string to inject into preview HTML.

   Behavior:
   - Inert by default — activates on postMessage from parent
   - Hover overlay on semantic elements (SECTION, DIV, TABLE, H1-H6, etc.)
   - Click captures: sectionId, elementTag, cssPath, elementText, elementHTML
   - Scroll-to-section support
   - Highlight-element pulse animation
   - In-document anchor navigation for sandboxed iframes
   ──────────────────────────────────────────────────────────────────── */

/**
 * Returns the annotation script to be injected into served artifact HTML.
 * The script is inert by default — it only activates when it receives
 * a postMessage from the parent frame.
 */
export function getAnnotationScript(): string {
  return `
<script>
(function() {
  // Intercept anchor-link clicks so in-document nav works inside sandboxed iframes.
  // Native hash navigation can fail when the iframe has an opaque origin (sandbox without allow-same-origin).
  document.addEventListener('click', function(e) {
    var anchor = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!anchor) return;
    var targetId = anchor.getAttribute('href').slice(1);
    if (!targetId) return;
    var target = document.getElementById(targetId);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  var active = false;
  var overlay = null;
  var label = null;

  var SEMANTIC_TAGS = [
    'SECTION','ARTICLE','NAV','HEADER','FOOTER','MAIN','ASIDE',
    'DIV','SVG','TABLE','FIGURE','UL','OL','DL',
    'H1','H2','H3','H4','H5','H6',
    'BLOCKQUOTE','PRE','IMG','CANVAS','FORM'
  ];

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'enter-annotation-mode') activate();
    if (e.data.type === 'exit-annotation-mode') deactivate();
    if (e.data.type === 'highlight-element') highlightElement(e.data.cssPath, e.data.sectionId);
    if (e.data.type === 'scroll-to-section') scrollToSection(e.data.sectionId);
  });

  function highlightElement(cssPath, sectionId) {
    var el = cssPath ? document.querySelector(cssPath) : null;
    if (!el && sectionId) el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'outline 0.2s, outline-offset 0.2s';
    el.style.outline = '3px solid #c87040';
    el.style.outlineOffset = '2px';
    setTimeout(function() {
      el.style.outline = '3px solid rgba(200,112,64,0.3)';
      setTimeout(function() {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 1500);
    }, 800);
  }

  function scrollToSection(sectionId) {
    var el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function activate() {
    if (active) return;
    active = true;

    overlay = document.createElement('div');
    overlay.id = '__codascope-overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #c87040;' +
      'background:rgba(200,112,64,0.06);z-index:99999;transition:top 0.08s,left 0.08s,width 0.08s,height 0.08s;' +
      'display:none;border-radius:3px;';
    document.body.appendChild(overlay);

    label = document.createElement('div');
    label.id = '__codascope-label';
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:100000;padding:2px 6px;' +
      'background:#c87040;color:#fff;font-size:10px;font-weight:700;font-family:system-ui,sans-serif;' +
      'border-radius:0 0 4px 4px;text-transform:uppercase;letter-spacing:0.5px;display:none;white-space:nowrap;';
    document.body.appendChild(label);

    document.addEventListener('mousemove', handleHover, true);
    document.addEventListener('click', handleClick, true);
    document.body.style.cursor = 'crosshair';
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', handleHover, true);
    document.removeEventListener('click', handleClick, true);
    document.body.style.cursor = '';
    if (overlay) { overlay.remove(); overlay = null; }
    if (label) { label.remove(); label = null; }
  }

  function findSemanticParent(el) {
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (SEMANTIC_TAGS.indexOf(current.tagName) !== -1) return current;
      current = current.parentElement;
    }
    return el;
  }

  function getSectionId(el) {
    var current = el;
    while (current) {
      if (current.dataset && current.dataset.sectionId) return current.dataset.sectionId;
      if (current.tagName === 'SECTION' && current.id) return current.id;
      current = current.parentElement;
    }
    return null;
  }

  function buildCssPath(el) {
    var parts = [];
    var current = el;
    var depth = 0;
    while (current && current !== document.body && depth < 4) {
      var seg = current.tagName.toLowerCase();
      if (current.id) { seg = '#' + current.id; parts.unshift(seg); break; }
      if (current.className && typeof current.className === 'string') {
        var cls = current.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) seg += '.' + cls;
      }
      parts.unshift(seg);
      current = current.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function handleHover(e) {
    if (!active || !overlay || !label) return;
    var target = findSemanticParent(e.target);
    var rect = target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    var sectionId = getSectionId(target);
    var tagName = target.tagName.toLowerCase();
    label.textContent = tagName + (sectionId ? ' in #' + sectionId : '');
    label.style.display = 'block';
    label.style.top = Math.max(0, rect.top) + 'px';
    label.style.left = rect.left + 'px';
  }

  function handleClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    var target = findSemanticParent(e.target);
    var sectionId = getSectionId(target);
    var text = (target.textContent || '').replace(/\\s+/g, ' ').trim();

    window.parent.postMessage({
      type: 'annotation-selected',
      sectionId: sectionId,
      elementTag: target.tagName.toLowerCase(),
      elementId: target.id || null,
      elementClasses: target.className && typeof target.className === 'string' ? target.className : '',
      elementText: text.slice(0, 200),
      elementHTML: target.outerHTML.slice(0, 500),
      cssPath: buildCssPath(target),
    }, '*');
  }
})();
</script>`;
}
