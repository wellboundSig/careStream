/**
 * WellboundLoader – SVG dot-matrix "WELLBOUND" logo loader.
 *
 * Usage:
 *   <div id="loader"></div>
 *   <script src="loader.js"></script>
 *   <script>WellboundLoader.init('#loader');</script>
 *
 * Options:
 *   scale   – size multiplier          (default 1)
 *   speed   – animation speed          (default 1)
 *   dotSize – dot radius in px         (default 3.2)
 *   gap     – grid step in px          (default 9)
 *   color   – dot fill colour          (default '#ffffff')
 */

;(function (root) {
  'use strict';

  var _instances = {};
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---- easing helpers ---- */

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

  /* soft bounce-out: overshoots then settles */
  function bounceOut(t) {
    t = clamp01(t);
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* smooth ease-out for the fade-down phase */
  function easeOutCubic(t) {
    t = clamp01(t);
    return 1 - Math.pow(1 - t, 3);
  }

  /* ease-in for the fade-down (invert of ease-out) */
  function easeInCubic(t) {
    t = clamp01(t);
    return t * t * t;
  }

  var WellboundLoader = {

    init: function (selector, opts) {
      opts = opts || {};
      var container = typeof selector === 'string'
        ? document.querySelector(selector) : selector;
      if (!container) { console.warn('WellboundLoader: container not found'); return; }

      var id = selector.toString();
      if (_instances[id]) this.destroy(selector);

      var scale   = opts.scale   || 1;
      var speed   = opts.speed   || 1;
      var dotSize = opts.dotSize || 3.2;
      var gap     = opts.gap     || 9;
      var color   = opts.color   || '#ffffff';

      /* ---- rasterise text ---- */
      var TEXT     = 'WELLBOUND';
      var tmp      = document.createElement('canvas');
      var tmpCtx   = tmp.getContext('2d');
      var fontSize = Math.round(72 * scale);

      tmpCtx.font = '900 ' + fontSize + 'px "Arial Black", "Impact", sans-serif';
      var textW = Math.ceil(tmpCtx.measureText(TEXT).width);
      var textH = Math.ceil(fontSize * 1.2);

      /* measure split point: width of "WELL" vs full word */
      var wellW = Math.ceil(tmpCtx.measureText('WELL').width);

      tmp.width  = textW + 20;
      tmp.height = textH + 10;
      tmpCtx.font         = '900 ' + fontSize + 'px "Arial Black", "Impact", sans-serif';
      tmpCtx.fillStyle    = '#fff';
      tmpCtx.textBaseline = 'top';
      tmpCtx.fillText(TEXT, 10, 5);

      var imgData     = tmpCtx.getImageData(0, 0, tmp.width, tmp.height).data;
      var samplingGap = Math.max(4, Math.round(gap * scale));

      /* split threshold in pixel space (account for the 10px left pad) */
      var splitX = wellW + 10;

      var dotsWell  = [];
      var dotsBound = [];

      for (var y = 0; y < tmp.height; y += samplingGap) {
        for (var x = 0; x < tmp.width; x += samplingGap) {
          var idx = (y * tmp.width + x) * 4;
          if (imgData[idx + 3] > 128) {
            var dot = { x: x, y: y };
            if (x < splitX) dotsWell.push(dot);
            else dotsBound.push(dot);
          }
        }
      }

      /* normalise x within each group 0→1 */
      function normalise(arr) {
        var mn = Infinity, mx = -Infinity;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].x < mn) mn = arr[i].x;
          if (arr[i].x > mx) mx = arr[i].x;
        }
        var rng = mx - mn || 1;
        for (var i = 0; i < arr.length; i++) {
          arr[i].nx = (arr[i].x - mn) / rng;
        }
      }
      normalise(dotsWell);
      normalise(dotsBound);

      var allDots = dotsWell.concat(dotsBound);

      /* ---- build SVG ---- */
      var PAD  = Math.round(20 * scale);
      var svgW = tmp.width  + PAD * 2;
      var svgH = tmp.height + PAD * 2;

      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('xmlns', SVG_NS);
      svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
      svg.setAttribute('width', svgW);
      svg.setAttribute('height', svgH);
      svg.style.display  = 'block';
      svg.style.maxWidth = '100%';
      svg.style.height   = 'auto';

      var rad = dotSize * scale;

      /* create circles for WELL group */
      var circlesWell = [];
      for (var i = 0; i < dotsWell.length; i++) {
        var c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', dotsWell[i].x + PAD);
        c.setAttribute('cy', dotsWell[i].y + PAD);
        c.setAttribute('r', rad);
        c.setAttribute('fill', color);
        svg.appendChild(c);
        circlesWell.push(c);
      }

      /* create circles for BOUND group */
      var circlesBound = [];
      for (var i = 0; i < dotsBound.length; i++) {
        var c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', dotsBound[i].x + PAD);
        c.setAttribute('cy', dotsBound[i].y + PAD);
        c.setAttribute('r', rad);
        c.setAttribute('fill', color);
        svg.appendChild(c);
        circlesBound.push(c);
      }

      container.appendChild(svg);

      /* ---- animation timeline (all times in seconds, scaled by speed) ---- */
      /*
       *  0.0 – 1.2   WELL sweeps on  (left→right bounce)
       *  0.6 – 1.8   BOUND sweeps on (right→left bounce, staggered)
       *  1.8 – 2.6   Hold at bright
       *  2.6 – 3.6   Everything dims back (ease-in)
       *  3.6 – 4.4   Rest at dim
       *  4.4         Loop
       */
      var TOTAL = 4.4 / speed;

      /* phase boundaries as fractions of TOTAL */
      var WELL_START   = 0;
      var WELL_DUR     = 1.2 / speed;
      var BOUND_START  = 0.6 / speed;
      var BOUND_DUR    = 1.2 / speed;
      var HOLD_END     = 2.6 / speed;
      var DIM_DUR      = 1.0 / speed;
      var DIM_END      = HOLD_END + DIM_DUR;

      var DIM_ALPHA    = 0.28;
      var BRIGHT_ALPHA = 1.0;

      var running = true;
      var rafId;

      function tick(time) {
        if (!running) return;

        var tSec = time * 0.001;
        var cyc  = tSec % TOTAL;       // position in current cycle

        /* --- compute WELL group intensity --- */
        for (var i = 0; i < dotsWell.length; i++) {
          var d = dotsWell[i];

          /* sweep: each dot triggers based on its nx (0→1 left to right) */
          var dotDelay   = d.nx * 0.45 / speed;        // stagger across WELL width
          var dotElapsed = (cyc - WELL_START - dotDelay);
          var sweepIn    = bounceOut(dotElapsed / (WELL_DUR * 0.7));

          /* dim phase: everything fades together */
          var fadeOut = 0;
          if (cyc > HOLD_END) {
            fadeOut = easeInCubic((cyc - HOLD_END) / DIM_DUR);
          }

          var intensity = sweepIn * (1 - fadeOut);
          intensity = clamp01(intensity);

          var alpha = DIM_ALPHA + (BRIGHT_ALPHA - DIM_ALPHA) * intensity;
          var r     = rad * (1 + 0.12 * intensity);

          circlesWell[i].setAttribute('r', r.toFixed(2));
          circlesWell[i].setAttribute('opacity', alpha.toFixed(3));
        }

        /* --- compute BOUND group intensity --- */
        for (var i = 0; i < dotsBound.length; i++) {
          var d = dotsBound[i];

          /* sweep: right→left (invert nx) for a different feel */
          var dotDelay   = (1 - d.nx) * 0.5 / speed;
          var dotElapsed = (cyc - BOUND_START - dotDelay);
          var sweepIn    = bounceOut(dotElapsed / (BOUND_DUR * 0.7));

          var fadeOut = 0;
          if (cyc > HOLD_END) {
            fadeOut = easeInCubic((cyc - HOLD_END) / DIM_DUR);
          }

          var intensity = sweepIn * (1 - fadeOut);
          intensity = clamp01(intensity);

          var alpha = DIM_ALPHA + (BRIGHT_ALPHA - DIM_ALPHA) * intensity;
          var r     = rad * (1 + 0.12 * intensity);

          circlesBound[i].setAttribute('r', r.toFixed(2));
          circlesBound[i].setAttribute('opacity', alpha.toFixed(3));
        }

        rafId = requestAnimationFrame(tick);
      }

      rafId = requestAnimationFrame(tick);

      _instances[id] = {
        el: svg,
        stop: function () { running = false; cancelAnimationFrame(rafId); }
      };
    },

    destroy: function (selector) {
      var id   = selector.toString();
      var inst = _instances[id];
      if (!inst) return;
      inst.stop();
      if (inst.el.parentNode) inst.el.parentNode.removeChild(inst.el);
      delete _instances[id];
    }
  };

  root.WellboundLoader = WellboundLoader;

})(typeof window !== 'undefined' ? window : this);
