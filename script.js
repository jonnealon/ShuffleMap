// ============================================================
// ICE Domestic Shuffle Flights — 2025
// Deck.gl + Mapbox GL JS
// ============================================================

// ── Mapbox token ──
mapboxgl.accessToken = 'pk.eyJ1IjoibmVhbG9uIiwiYSI6ImNtbmtsMzN4NDEwejcycXBremQxd3ZsdGYifQ.L-0eyFQp2rjCgxa6cxR2_w';

// ── Contractor color palette ──
const CONTRACTOR_CONFIG = {
  'GlobalX':             { color: [230, 57,  70],  hex: '#e63946' },
  'Eastern Air Express': { color: [69,  123, 157], hex: '#457b9d' },
  'Avelo':               { color: [244, 197, 66],  hex: '#f4c542' },
  'Key Lime':            { color: [45,  198, 83],  hex: '#2dc653' },
  'US Coast Guard':      { color: [155, 93,  229], hex: '#9b5de5' },
  'CSI Aviation':        { color: [247, 127, 0],   hex: '#f77f00' },
  'Other':               { color: [136, 136, 136], hex: '#888888' },
};

const MAIN_CONTRACTORS = Object.keys(CONTRACTOR_CONFIG);
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── State ──
let flightData        = [];
let airportData       = [];
let routeFreq         = {};
let activeContractors = new Set(MAIN_CONTRACTORS);
let activeMonths      = new Set();
let presentMonths     = [];
let deckgl;

// ── Animation state ──
let animating      = false;

// ── Preview state (hover when nothing selected) ──
let previewMonths     = null;  // Set or null
let previewContractor = null;  // string or null
let animInterval   = null;
let animMonthIndex = 0;
const ANIM_SPEED_MS = 1200;

// ── Helpers ──
function getGroup(carrier) {
  return MAIN_CONTRACTORS.includes(carrier) ? carrier : 'Other';
}
function getColor(carrier, alpha) {
  alpha = alpha === undefined ? 180 : alpha;
  const cfg = CONTRACTOR_CONFIG[getGroup(carrier)];
  return [cfg.color[0], cfg.color[1], cfg.color[2], alpha];
}
function getHex(carrier) {
  return CONTRACTOR_CONFIG[getGroup(carrier)].hex;
}
function airportRadius(totalFlights) {
  return Math.sqrt(parseFloat(totalFlights) || 1) * 600;
}

// ── Initialize DeckGL ──
deckgl = new deck.DeckGL({
  container: 'map',
  mapboxApiAccessToken: mapboxgl.accessToken,
  mapStyle: 'mapbox://styles/mapbox/satellite-v9',
  mapOptions: { projection: 'mercator' },
  initialViewState: {
    longitude: -95,
    latitude:   36,
    zoom:        3.8,
    pitch:       0,
    bearing:      0,
  },
  controller: true,
  layers: [],
});

setTimeout(function() {
  var mapCanvas = document.querySelector('#map canvas:first-child');
  if (mapCanvas) mapCanvas.style.filter = 'brightness(0.4)';
}, 500);

// ── Tooltip ──
var tooltipEl = document.getElementById('tooltip');

function handleHover(info) {
  if (!info.object) { tooltipEl.style.display = 'none'; return; }
  var d = info.object;
  var html = '';
  if (d['Departure City']) {
    var hex   = getHex(d.Carrier);
    var group = getGroup(d.Carrier);
    var key   = d.Carrier + '||' + d['Departure Airport'] + '||' + d['Destination Airport'];
    var count = routeFreq[key] || 1;
    html = '<strong>' + d['Departure City'] + ' &rarr; ' + d['Destination City'] + '</strong>' +
           '<span class="carrier-tag" style="background:' + hex + '">' + group + '</span><br>' +
           '<span class="meta">Flown ' + count + ' time' + (count !== 1 ? 's' : '') + ' in 2025</span><br>' +
           '<span class="meta">' + d.Date + ' &nbsp;&middot;&nbsp; ' + (d.Type || '') + '</span>';
  } else {
    var total = parseFloat(d.total_flights) || 0;
    html = '<strong>' + d.airport + '</strong>' +
           '<span class="meta">' + d.city + '</span><br>' +
           '<span class="meta">' + total.toLocaleString() + ' shuffle flights</span>';
  }
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = 'block';
  tooltipEl.style.left = (info.x + 14) + 'px';
  tooltipEl.style.top  = (info.y + 14) + 'px';
}

// ── Render layers ──
function updateLayers() {
  // Don't update main layers until intro is dismissed
  if (introPhase < 2) return;

  // Use preview overrides when hovering with nothing selected
  var monthFilter      = previewMonths     || activeMonths;
  var contractorFilter = previewContractor ? new Set([previewContractor]) : activeContractors;

  var visible = flightData.filter(function(d) {
    return contractorFilter.has(getGroup(d.Carrier)) && monthFilter.has(d._month);
  });

  var arcLayer = new deck.ArcLayer({
    id: 'shuffle-arcs',
    data: visible,
    getSourcePosition: function(d) { return [parseFloat(d.dep_lon),  parseFloat(d.dep_lat)];  },
    getTargetPosition: function(d) { return [parseFloat(d.dest_lon), parseFloat(d.dest_lat)]; },
    getSourceColor: function(d) { return getColor(d.Carrier, 180); },
    getTargetColor: function(d) { return getColor(d.Carrier, 180);  },
    getHeight: 1,
    getWidth: 1.2,
    getTilt: function(d) { 
  var t = parseFloat(d.tilt) || 0;
  return t < 0 ? 5 : 5;
},
    pickable: true,
    onHover:  handleHover,
    updateTriggers: { getSourceColor: [...activeContractors], getTargetColor: [...activeContractors] },
  });

  var scatterLayer = new deck.ScatterplotLayer({
    id: 'airport-nodes',
    data: airportData,
    getPosition: function(d) { return [parseFloat(d.lon), parseFloat(d.lat)]; },
    getRadius:    function(d) { return airportRadius(d.total_flights); },
    getFillColor: [255, 255, 255, 40],
    getLineColor: [255, 255, 255, 120],
    stroked: true,
    lineWidthMinPixels: 1,
    radiusMinPixels: 3,
    radiusMaxPixels: 28,
    pickable: true,
    onHover: handleHover,
  });

  deckgl.setProps({ layers: [scatterLayer, arcLayer] });
  document.getElementById('flightCount').textContent = visible.length.toLocaleString();
}

// ── Contractor filter ──
function buildControls() {
  var counts = {};
  MAIN_CONTRACTORS.forEach(function(c) { counts[c] = 0; });
  flightData.forEach(function(d) {
    var g = getGroup(d.Carrier);
    counts[g] = (counts[g] || 0) + 1;
  });

  var container = document.getElementById('contractors');
  container.innerHTML = '';

  MAIN_CONTRACTORS.forEach(function(name) {
    if (!counts[name]) return;
    var hex = CONTRACTOR_CONFIG[name].hex;
    var row = document.createElement('label');
    row.className = 'contractor-row';

    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.style.color = hex;
    cb.addEventListener('change', function() {
      if (cb.checked) activeContractors.add(name);
      else activeContractors.delete(name);
      updateToggleLabel();
      updateLayers();
    });

    // Preview on hover when no contractors are selected
    row.addEventListener('mouseenter', function() {
      if (activeContractors.size === 0) {
        previewContractor = name;
        updateLayers();
      }
    });
    row.addEventListener('mouseleave', function() {
      if (previewContractor) {
        previewContractor = null;
        updateLayers();
      }
    });

    var dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = hex;

    var lbl = document.createElement('span');
    lbl.className = 'contractor-name'; lbl.textContent = name;

    var cnt = document.createElement('span');
    cnt.className = 'contractor-count'; cnt.textContent = counts[name].toLocaleString();

    row.appendChild(cb); row.appendChild(dot); row.appendChild(lbl); row.appendChild(cnt);
    container.appendChild(row);
  });

  document.getElementById('toggleAll').addEventListener('click', function() {
    var allOn = activeContractors.size === MAIN_CONTRACTORS.length;
    activeContractors = allOn ? new Set() : new Set(MAIN_CONTRACTORS);
    container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) { cb.checked = !allOn; });
    updateToggleLabel();
    updateLayers();
  });
}

function updateToggleLabel() {
  var allOn = activeContractors.size >= MAIN_CONTRACTORS.length;
  document.getElementById('toggleAll').textContent = allOn ? 'Deselect All' : 'Select All';
}

// ── Month filter ──
function buildMonthControls() {
  var monthSet = new Set(flightData.map(function(d) { return d._month; }).filter(Boolean));
  presentMonths = Array.from(monthSet).sort(function(a,b) { return a-b; });

  var container = document.getElementById('months');
  container.innerHTML = '';

  presentMonths.forEach(function(monthNum) {
    var btn = document.createElement('button');
    btn.className = 'month-btn';
    btn.textContent = MONTH_NAMES[monthNum - 1];
    btn.dataset.month = monthNum;

    btn.addEventListener('click', function() {
      if (animating) stopAnimation();
      if (activeMonths.has(monthNum)) { activeMonths.delete(monthNum); btn.classList.remove('active'); }
      else { activeMonths.add(monthNum); btn.classList.add('active'); }
      updateMonthToggleLabel();
      updateLayers();
    });

    // Preview on hover when no months are selected
    btn.addEventListener('mouseenter', function() {
      if (activeMonths.size === 0) {
        previewMonths = new Set([monthNum]);
        updateLayers();
      }
    });
    btn.addEventListener('mouseleave', function() {
      if (previewMonths) {
        previewMonths = null;
        updateLayers();
      }
    });

    container.appendChild(btn);
  });

  document.getElementById('toggleMonths').addEventListener('click', function() {
    if (animating) stopAnimation();
    var allOn = presentMonths.every(function(m) { return activeMonths.has(m); });
    presentMonths.forEach(function(m) { if (allOn) activeMonths.delete(m); else activeMonths.add(m); });
    container.querySelectorAll('.month-btn').forEach(function(b) { b.classList.toggle('active', !allOn); });
    updateMonthToggleLabel();
    updateLayers();
  });

  document.getElementById('playMonths').addEventListener('click', function() {
    if (animating) stopAnimation(); else startAnimation();
  });
}

function updateMonthToggleLabel() {
  var allOn = presentMonths.every(function(m) { return activeMonths.has(m); });
  document.getElementById('toggleMonths').textContent = allOn ? 'Deselect All' : 'Select All';
}

// ── Animation ──
function startAnimation() {
  animating = true;
  document.getElementById('playMonths').textContent = '⏸ Pause';
  animMonthIndex = 0;
  stepAnimation();
  animInterval = setInterval(function() {
    animMonthIndex = (animMonthIndex + 1) % presentMonths.length;
    stepAnimation();
  }, ANIM_SPEED_MS);
}

function stopAnimation() {
  animating = false;
  clearInterval(animInterval);
  animInterval = null;
  document.getElementById('playMonths').textContent = '▶ Play';
  presentMonths.forEach(function(m) { activeMonths.add(m); });
  document.querySelectorAll('.month-btn').forEach(function(b) {
    b.classList.add('active');
    b.classList.remove('anim-current');
  });
  var label = document.getElementById('currentMonthLabel');
  if (label) label.textContent = '';
  updateMonthToggleLabel();
  updateLayers();
}

function stepAnimation() {
  var currentMonth = presentMonths[animMonthIndex];
  activeMonths = new Set([currentMonth]);
  document.querySelectorAll('.month-btn').forEach(function(b) {
    var isActive = parseInt(b.dataset.month) === currentMonth;
    b.classList.toggle('active', isActive);
    b.classList.toggle('anim-current', isActive);
  });
  var label = document.getElementById('currentMonthLabel');
  if (label) label.textContent = MONTH_NAMES[currentMonth - 1] + ' 2025';
  updateLayers();
}

// ── Load data ──
function loadData() {
  Papa.parse('data/shuffles_2025_clean.csv', {
    download: true, header: true, skipEmptyLines: true,
    complete: function(results) {
      flightData = results.data.filter(function(d) {
        return d.dep_lat && d.dep_lon && d.dest_lat && d.dest_lon;
      });
      flightData.forEach(function(d) {
        d._month = d.Date ? parseInt(d.Date.split('-')[1]) : null;
      });
      flightData.forEach(function(d) {
        var key = d.Carrier + '||' + d['Departure Airport'] + '||' + d['Destination Airport'];
        routeFreq[key] = (routeFreq[key] || 0) + 1;
      });
      Papa.parse('data/shuffle_airports_2025.csv', {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results2) {
          airportData = results2.data.filter(function(d) { return d.lat && d.lon; });
          buildControls();
          buildMonthControls();
          document.getElementById('loading').classList.add('hidden');
          // Show sparse background arcs behind intro
          showIntroBackground();
        },
      });
    },
  });
}

setTimeout(loadData, 300);

// ══════════════════════════════════════
// INTRO SEQUENCE
// ══════════════════════════════════════

var introPhase = 0; // 0 = title only, 1 = paragraph visible, 2 = done

function showIntroBackground() {
  // Show ~80 random flights behind the intro at low opacity
  if (!flightData.length) return;
  var sample = flightData
    .slice()
    .sort(function() { return Math.random() - 0.5; })
    .slice(0, 80);

  var bgArcs = new deck.ArcLayer({
    id: 'intro-arcs',
    data: sample,
    getSourcePosition: function(d) { return [parseFloat(d.dep_lon), parseFloat(d.dep_lat)]; },
    getTargetPosition: function(d) { return [parseFloat(d.dest_lon), parseFloat(d.dest_lat)]; },
    getSourceColor: function(d) { return getColor(d.Carrier, 120); },
    getTargetColor: function(d) { return getColor(d.Carrier, 20); },
    getHeight: 0.35,
    getWidth: 1,
    getTilt: function(d) { 
  var t = parseFloat(d.tilt) || 0;
  return t < 0 ? -30 : 30;
},
    pickable: false,
  });

  deckgl.setProps({ layers: [bgArcs] });
}

function advanceIntro() {
  if (introPhase === 0) {
    // Phase 1: show paragraph
    document.getElementById('introBody').classList.add('visible');
    document.getElementById('introPrompt').textContent = 'Click to explore the map';
    document.getElementById('introPrompt').classList.add('phase2');
    introPhase = 1;

  } else if (introPhase === 1) {
    // Phase 2: dismiss intro, show full map
    introPhase = 2;
    document.getElementById('intro').classList.add('hidden');

    // Reveal panel
    var panel = document.getElementById('panel');
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'auto';

    // Switch to full flight data
    updateLayers();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  var intro = document.getElementById('intro');

  intro.addEventListener('click', advanceIntro);
  document.addEventListener('wheel', function(e) {
    if (introPhase < 2) {
      e.preventDefault();
      advanceIntro();
    }
  }, { passive: false });

  document.addEventListener('keydown', function(e) {
    if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') && introPhase < 2) {
      advanceIntro();
    }
  });
});
