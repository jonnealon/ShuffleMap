// ============================================================
// ICE Domestic Shuffle Flights — 2025
// Deck.gl + Mapbox GL JS
// Jon Nealon AGOG 510 Final Project
// ============================================================

mapboxgl.accessToken = 'pk.eyJ1IjoibmVhbG9uIiwiYSI6ImNtbmtsMzN4NDEwejcycXBremQxd3ZsdGYifQ.L-0eyFQp2rjCgxa6cxR2_w';

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
var flightData        = [];
var airportData       = [];
var routeFreq         = {};
var activeContractors = new Set(MAIN_CONTRACTORS);
var activeMonths      = new Set();
var presentMonths     = [];
var previewMonths     = null;
var previewContractor = null;
var deckgl;

// ── Animation state ──
var animating      = false;
var animInterval   = null;
var animMonthIndex = 0;
var ANIM_SPEED_MS  = 2800;

// ── Intro state ──
// 0=title, 1=para1, 2=para2, 3=airports, 4=animation, 5=free
var introPhase = 0;

// ── Drift state ──
var driftInterval = null;
var driftBearing  = 0;
var driftLat      = 36;
var driftPitch    = 0;
var driftDir      = 1;

// ── Helpers ──
function getGroup(carrier) {
  return MAIN_CONTRACTORS.includes(carrier) ? carrier : 'Other';
}
function getColor(carrier, alpha) {
  alpha = (alpha === undefined) ? 180 : alpha;
  var cfg = CONTRACTOR_CONFIG[getGroup(carrier)];
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
    bearing:     0,
  },
  controller: { minZoom: 3.2 },
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
  if (introPhase < 3) return;
  var monthFilter      = previewMonths || activeMonths;
  var contractorFilter = previewContractor ? new Set([previewContractor]) : activeContractors;

  var visible = flightData.filter(function(d) {
    return contractorFilter.has(getGroup(d.Carrier)) && monthFilter.has(d._month);
  });

  var arcLayer = new deck.ArcLayer({
    id: 'shuffle-arcs',
    data: visible,
    getSourcePosition: function(d) { return [parseFloat(d.dep_lon), parseFloat(d.dep_lat)]; },
    getTargetPosition: function(d) { return [parseFloat(d.dest_lon), parseFloat(d.dest_lat)]; },
    getSourceColor: function(d) { return getColor(d.Carrier, 180); },
    getTargetColor: function(d) { return getColor(d.Carrier, 180); },
    getHeight: 1,
    getWidth: 1.2,
    getTilt: function(d) {
      var t = parseFloat(d.tilt) || 0;
      return t < 0 ? 5 : 5;
    },
    pickable: true,
    onHover: handleHover,
    updateTriggers: { getSourceColor: [...activeContractors], getTargetColor: [...activeContractors] },
    transitions: {
      getSourceColor: { duration: 600, type: 'interpolation' },
      getTargetColor: { duration: 600, type: 'interpolation' },
    },
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

function showAirportsOnly() {
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
  deckgl.setProps({ layers: [scatterLayer] });
}
// Hi Joey, Are you looking through my code? 
// thanks for the great class - Jon 

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

    row.addEventListener('mouseenter', function() {
      if (activeContractors.size === 0) { previewContractor = name; updateLayers(); }
    });
    row.addEventListener('mouseleave', function() {
      if (previewContractor) { previewContractor = null; updateLayers(); }
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
      if (animating) stopAnimation(false);
      if (activeMonths.has(monthNum)) { activeMonths.delete(monthNum); btn.classList.remove('active'); }
      else { activeMonths.add(monthNum); btn.classList.add('active'); }
      updateMonthToggleLabel();
      updateLayers();
    });

    btn.addEventListener('mouseenter', function() {
      if (activeMonths.size === 0) { previewMonths = new Set([monthNum]); updateLayers(); }
    });
    btn.addEventListener('mouseleave', function() {
      if (previewMonths) { previewMonths = null; updateLayers(); }
    });

    container.appendChild(btn);
  });

  document.getElementById('toggleMonths').addEventListener('click', function() {
    if (animating) stopAnimation(false);
    var allOn = presentMonths.every(function(m) { return activeMonths.has(m); });
    presentMonths.forEach(function(m) { if (allOn) activeMonths.delete(m); else activeMonths.add(m); });
    container.querySelectorAll('.month-btn').forEach(function(b) { b.classList.toggle('active', !allOn); });
    updateMonthToggleLabel();
    updateLayers();
  });

  document.getElementById('playMonths').addEventListener('click', function() {
    if (animating) stopAnimation(false); else startAnimation();
  });
}

function updateMonthToggleLabel() {
  var allOn = presentMonths.length > 0 && presentMonths.every(function(m) { return activeMonths.has(m); });
  document.getElementById('toggleMonths').textContent = allOn ? 'Deselect All' : 'Select All';
}

// ── Animation ──
function startAnimation() {
  animating = true;
  document.getElementById('playMonths').textContent = '⏸ Pause';
  var md = document.getElementById('animMonthDisplay');
  if (md) md.classList.add('visible');
  animMonthIndex = 0;
  stepAnimation();
  animInterval = setInterval(function() {
    animMonthIndex = (animMonthIndex + 1) % presentMonths.length;
    stepAnimation();
  }, ANIM_SPEED_MS);
}

// clearMonths=true: called from phase 5, clears selection
// clearMonths=false: called from pause button, restores all months
function stopAnimation(clearMonths) {
  animating = false;
  clearInterval(animInterval);
  animInterval = null;
  document.getElementById('playMonths').textContent = '▶ Play';
  var md = document.getElementById('animMonthDisplay');
  if (md) md.classList.remove('visible');
  var lbl = document.getElementById('currentMonthLabel');
  if (lbl) lbl.textContent = '';

  if (clearMonths) {
    activeMonths = new Set();
    document.querySelectorAll('.month-btn').forEach(function(b) {
      b.classList.remove('active');
      b.classList.remove('anim-current');
    });
  } else {
    presentMonths.forEach(function(m) { activeMonths.add(m); });
    document.querySelectorAll('.month-btn').forEach(function(b) {
      b.classList.add('active');
      b.classList.remove('anim-current');
    });
  }
  updateMonthToggleLabel();
  updateLayers();
}

function stepAnimation() {
  var currentMonth = presentMonths[animMonthIndex];
  activeMonths = new Set([currentMonth]);
  previewMonths = null;
  document.querySelectorAll('.month-btn').forEach(function(b) {
    var isActive = parseInt(b.dataset.month) === currentMonth;
    b.classList.toggle('active', isActive);
    b.classList.toggle('anim-current', isActive);
  });
  var lbl = document.getElementById('currentMonthLabel');
  if (lbl) lbl.textContent = MONTH_NAMES[currentMonth - 1] + ' 2025';
  var monthCount = flightData.filter(function(d) { return d._month === currentMonth; }).length;
  var mt = document.getElementById('animMonthText');
  if (mt) mt.textContent = MONTH_NAMES[currentMonth - 1].toUpperCase() + ' 2025' + '  ·  ' + monthCount.toLocaleString() + ' flights';
  updateLayers();
}

// ── Drift ──
function startDrift() {
  if (driftInterval) return;
  driftBearing = 0;
  driftLat     = 36;
  driftPitch   = 0;
  driftDir     = 1;
  var MAX_BEARING = 25;
  driftInterval = setInterval(function() {
    driftBearing += 0.03 * driftDir;
    if (driftBearing >= MAX_BEARING)  driftDir = -1;
    if (driftBearing <= -MAX_BEARING) driftDir = 1;
    driftLat += 0.002 * driftDir;
    driftLat = Math.max(33, Math.min(39, driftLat));
    driftPitch = Math.min(driftPitch + 0.04, 38);
    deckgl.setProps({
      initialViewState: {
        longitude: -95,
        latitude:  driftLat,
        zoom:       3.8,
        pitch:      driftPitch,
        bearing:    driftBearing,
        transitionDuration: 200,
      }
    });
  }, 80);
}

function stopDrift() {
  if (driftInterval) { clearInterval(driftInterval); driftInterval = null; }
  deckgl.setProps({
    initialViewState: {
      longitude: -95,
      latitude:   36,
      zoom:        3.8,
      pitch:       0,
      bearing:     0,
      transitionDuration: 1200,
    }
  });
}

// ── Intro background arcs ──
function showIntroBackground() {
  if (!flightData.length) return;
  var sample = flightData.slice().sort(function() { return Math.random() - 0.5; }).slice(0, 80);
  deckgl.setProps({
    layers: [new deck.ArcLayer({
      id: 'intro-arcs',
      data: sample,
      getSourcePosition: function(d) { return [parseFloat(d.dep_lon), parseFloat(d.dep_lat)]; },
      getTargetPosition: function(d) { return [parseFloat(d.dest_lon), parseFloat(d.dest_lat)]; },
      getSourceColor: function(d) { return getColor(d.Carrier, 120); },
      getTargetColor: function(d) { return getColor(d.Carrier, 20); },
      getHeight: 0.35,
      getWidth: 1,
      getTilt: 5,
      pickable: false,
    })]
  });
}

// ── Intro sequence ──
function advanceIntro() {
  if (introPhase === 0) {
    document.getElementById('introBody').classList.add('visible');
    document.getElementById('introPrompt').textContent = 'Click to continue \u2192';
    introPhase = 1;

  } else if (introPhase === 1) {
    document.getElementById('introBody2').classList.add('visible');
    document.getElementById('introPrompt').textContent = 'Click to explore the map \u2192';
    introPhase = 2;

  } else if (introPhase === 2) {
    introPhase = 3;
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('storyOverlay').classList.add('active');
    showAirportsOnly();
    startDrift();
    setTimeout(function() {
      document.getElementById('storyAirports').classList.add('visible');
    }, 400);

  } else if (introPhase === 3) {
    introPhase = 4;
    document.getElementById('storyAirports').classList.remove('visible');
    activeContractors = new Set(MAIN_CONTRACTORS);
    setTimeout(function() {
      document.getElementById('storyAnimation').classList.add('visible');
      startAnimation();
    }, 400);

  } else if (introPhase === 4) {
    introPhase = 5;
    stopAnimation(true);   // clears months, shows Select All
    stopDrift();
    document.getElementById('storyAnimation').classList.remove('visible');
    document.getElementById('storyOverlay').classList.remove('active');
    document.getElementById('storyOverlay').style.display = 'none';
    var panel = document.getElementById('panel');
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'auto';
    updateLayers();
  }
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
          showIntroBackground();
        },
      });
    },
  });
}

setTimeout(loadData, 300);

// ── Event listeners ──
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('intro').addEventListener('click', advanceIntro);
  document.getElementById('storyOverlay').addEventListener('click', advanceIntro);
  document.getElementById('storyAirports').addEventListener('click', advanceIntro);
  document.getElementById('storyAnimation').addEventListener('click', advanceIntro);

  var lastWheelTime = 0;
  document.addEventListener('wheel', function(e) {
    if (introPhase >= 5) return;
    e.preventDefault();
    var now = Date.now();
    if (now - lastWheelTime < 800) return;
    if (Math.abs(e.deltaY) < 10 && e.deltaMode === 0) return;
    lastWheelTime = now;
    advanceIntro();
  }, { passive: false });

  document.addEventListener('keydown', function(e) {
    if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') && introPhase < 5) {
      advanceIntro();
    }
  });
});
