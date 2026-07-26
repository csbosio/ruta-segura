// Desregistro automático de Service Workers antiguos para forzar actualización
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (let registration of registrations) { registration.unregister(); }
  });
}

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_ORIGIN = [-31.4201, -64.1888];

let map, userPos = null, destPos = null;
let currentRoute = null, detourRoute = null;
let availableDetours = [];
let currentDetourIndex = 0;

let routeLayer = null, detourLayer = null;
let userMarker = null, destMarker = null;
let activeIncidents = [];
let debounceTimer = null;
let settingOriginMode = false;
let activeInputTarget = 'dest';

const SAFETY_BUFFER_METERS = 100;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  getUserLocation();
});

function initMap() {
  map = L.map('map', { zoomControl: false }).setView(DEFAULT_ORIGIN, 14);

  // MAPA FUTURISTA EN MODO OSCURO (CartoDB Dark Matter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  map.on('click', function(e) {
    document.getElementById('suggestions').style.display = 'none';
    closeAllMenus();
    
    if (settingOriginMode) {
      setOriginFromMap(e.latlng);
      settingOriginMode = false;
    } else {
      setDestinationFromMap(e.latlng);
    }
  });
}

function getUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      userPos = [pos.coords.latitude, pos.coords.longitude];
      document.getElementById('originInput').value = 'Mi ubicación actual';
      updateUserMarker();
      map.setView(userPos, 15);
      showToast('📍 Ubicación detectada');
    },
    () => {
      userPos = DEFAULT_ORIGIN;
      document.getElementById('originInput').value = 'Córdoba Centro';
      updateUserMarker();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function updateUserMarker() {
  if (!userPos) return;
  if (!userMarker) {
    userMarker = L.marker(userPos, {
      icon: L.divIcon({
        className: 'custom-icon-marker',
        html: '<div style="width:24px;height:24px;background:#00f2fe;border-radius:50%;border:3px solid #fff;box-shadow:0 0 15px #00f2fe;"></div>',
        iconSize: [24, 24], iconAnchor: [12, 12]
      })
    }).addTo(map);
  } else {
    userMarker.setLatLng(userPos);
  }
}

function enableSetOriginMode() {
  settingOriginMode = true;
  showToast('👉 Tocá en el mapa para fijar tu ORIGEN (🚗)');
}

async function setOriginFromMap(latlng) {
  userPos = [latlng.lat, latlng.lng];
  updateUserMarker();
  
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json`);
    const data = await res.json();
    if (data && data.display_name) {
      document.getElementById('originInput').value = data.display_name.split(',')[0];
    }
  } catch(e){}

  if (destPos) recalculateSmartRoute();
}

async function setDestinationFromMap(latlng) {
  destPos = [latlng.lat, latlng.lng];

  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker(destPos, {
    icon: L.divIcon({
      className: 'custom-icon-marker',
      html: '<div style="font-size:36px; filter: drop-shadow(0 0 8px #00f2fe);">🏁</div>',
      iconSize: [40, 40],
      iconAnchor: [20, 40]
    })
  }).addTo(map);

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json`);
    const data = await res.json();
    if (data && data.display_name) {
      document.getElementById('destInput').value = data.display_name.split(',')[0];
    }
  } catch(e){}

  if (userPos) recalculateSmartRoute();
}

function handleSearchInput(query, target) {
  activeInputTarget = target;
  clearTimeout(debounceTimer);
  const suggBox = document.getElementById('suggestions');
  
  if (!query || query.trim().length < 2) {
    suggBox.style.display = 'none'; 
    return;
  }

  debounceTimer = setTimeout(async () => {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query + ', Córdoba, Argentina')}&format=json&limit=5`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      suggBox.innerHTML = '';
      if (data && data.length > 0) {
        data.forEach(place => {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.textContent = place.display_name;
          item.onclick = () => {
            const latlng = [parseFloat(place.lat), parseFloat(place.lon)];
            
            if (activeInputTarget === 'origin') {
              userPos = latlng;
              document.getElementById('originInput').value = place.display_name.split(',')[0];
              updateUserMarker();
            } else {
              destPos = latlng;
              document.getElementById('destInput').value = place.display_name.split(',')[0];
              if (destMarker) map.removeLayer(destMarker);
              destMarker = L.marker(destPos, {
                icon: L.divIcon({
                  className: 'custom-icon-marker',
                  html: '<div style="font-size:36px; filter: drop-shadow(0 0 8px #00f2fe);">🏁</div>',
                  iconSize: [40, 40],
                  iconAnchor: [20, 40]
                })
              }).addTo(map);
            }

            suggBox.style.display = 'none';
            map.setView(latlng, 15);
            if (userPos && destPos) recalculateSmartRoute();
          };
          suggBox.appendChild(item);
        });
        suggBox.style.display = 'block';
      }
    } catch (e) {}
  }, 250);
}

function clearOrigin() {
  userPos = null;
  document.getElementById('originInput').value = '';
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  clearRoutes();
  showToast('Origen eliminado');
}

function clearDestination() {
  destPos = null;
  document.getElementById('destInput').value = '';
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  clearRoutes();
  showToast('Destino eliminado');
}

function clearRoutes() {
  if (routeLayer) map.removeLayer(routeLayer);
  if (detourLayer) map.removeLayer(detourLayer);
  document.getElementById('navPanel').style.display = 'none';
}

function toggleMenu(menuId) {
  const target = document.getElementById(menuId);
  const isOpen = target.classList.contains('active');
  closeAllMenus();
  if (!isOpen) target.classList.add('active');
}

function closeAllMenus() {
  document.getElementById('hornOptions').classList.remove('active');
  document.getElementById('alertOptions').classList.remove('active');
}

// REPORTAR INCIDENTE CON ÍCONOS MÁS GRANDES Y SIN MARCO NEGRO
function reportIncident(type, label) {
  closeAllMenus();
  const centerPos = map.getCenter();
  const emoji = label.split(' ')[0];
  
  const incidentMarker = L.marker(centerPos, {
    draggable: true,
    icon: L.divIcon({
      className: 'custom-icon-marker',
      html: `<div class="draggable-marker">${emoji}</div>`,
      iconSize: [50, 50], 
      iconAnchor: [25, 25]
    })
  }).addTo(map);

  const incidentObj = { id: Date.now(), pos: [centerPos.lat, centerPos.lng], marker: incidentMarker };
  activeIncidents.push(incidentObj);

  const popupContent = document.createElement('div');
  popupContent.style.textAlign = 'center';
  popupContent.innerHTML = `<div style="font-weight:bold; color:#00f2fe;">${label}</div>`;
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'popup-delete-btn';
  deleteBtn.innerHTML = '❌ Eliminar';
  deleteBtn.onclick = () => { 
    map.removeLayer(incidentMarker); 
    activeIncidents = activeIncidents.filter(i => i.id !== incidentObj.id);
    recalculateSmartRoute();
  };
  
  popupContent.appendChild(deleteBtn);
  incidentMarker.bindPopup(popupContent);

  incidentMarker.on('dragend', function(event) {
    const newPos = event.target.getLatLng();
    incidentObj.pos = [newPos.lat, newPos.lng];
    recalculateSmartRoute();
  });

  showToast(`¡${label} agregado! Reevaluando...`);
  recalculateSmartRoute();
}

async function fetchOSRM(points) {
  const coords = points.map(p => `${p[1]},${p[0]}`).join(';');
  const url = `${OSRM_URL}${coords}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes.length > 0) {
      return data.routes.map(r => ({
        coords: r.geometry.coordinates.map(c => [c[1], c[0]]),
        distance: r.distance,
        duration: r.duration
      }));
    }
  } catch (e) {}
  return [];
}

function calculateRoute() {
  document.getElementById('suggestions').style.display = 'none';
  if (!userPos || !destPos) {
    showToast('⚠️ Definí Origen y Destino primero');
    return;
  }
  recalculateSmartRoute();
}

function isRouteSafe(coords) {
  if (activeIncidents.length === 0) return true;
  return coords.every(coord => {
    return activeIncidents.every(incident => {
      return getDistanceMeters(coord, incident.pos) > SAFETY_BUFFER_METERS;
    });
  });
}

async function recalculateSmartRoute() {
  if (!userPos || !destPos) return;

  const directRoutes = await fetchOSRM([userPos, destPos]);
  if (directRoutes.length === 0) return;

  currentRoute = directRoutes[0];
  drawRoute(currentRoute.coords, '#00f2fe', false); // Color Neón Cían para la ruta principal
  updateNavInfo(currentRoute);

  if (activeIncidents.length === 0 || isRouteSafe(currentRoute.coords)) {
    if (detourLayer) map.removeLayer(detourLayer);
    document.getElementById('btnDetour').style.display = 'none';
    document.getElementById('btnNextDetour').style.display = 'none';
    availableDetours = [];
    return;
  }

  const offsets = [0.0012, -0.0012, 0.0022, -0.0022];
  let promises = [];

  for (let incident of activeIncidents) {
    const cLat = incident.pos[0];
    const cLng = incident.pos[1];

    for (let latOff of offsets) {
      for (let lngOff of offsets) {
        const bypass = [cLat + latOff, cLng + lngOff];
        if (activeIncidents.every(inc => getDistanceMeters(bypass, inc.pos) > SAFETY_BUFFER_METERS)) {
          promises.push(fetchOSRM([userPos, bypass, destPos]));
        }
      }
    }
  }

  const resultsArray = await Promise.all(promises);
  let validCandidates = [];

  resultsArray.forEach(routes => {
    routes.forEach(tRoute => {
      if (isRouteSafe(tRoute.coords)) {
        if (!validCandidates.some(r => Math.abs(r.distance - tRoute.distance) < 25)) {
          validCandidates.push(tRoute);
        }
      }
    });
  });

  if (validCandidates.length > 0) {
    validCandidates.sort((a, b) => a.distance - b.distance);
    availableDetours = validCandidates;
    currentDetourIndex = 0;

    renderCurrentDetour();
    document.getElementById('btnDetour').style.display = 'block';
    
    if (availableDetours.length > 1) {
      document.getElementById('btnNextDetour').style.display = 'block';
    } else {
      document.getElementById('btnNextDetour').style.display = 'none';
    }

    showToast(`⚡ ${availableDetours.length} atajo(s) calculado(s)`);
  } else {
    if (detourLayer) map.removeLayer(detourLayer);
    document.getElementById('btnDetour').style.display = 'none';
    document.getElementById('btnNextDetour').style.display = 'none';
    availableDetours = [];
    showToast('⚠️ No se hallaron desvíos libres cerca');
  }
}

function renderCurrentDetour() {
  if (availableDetours.length === 0) return;
  detourRoute = availableDetours[currentDetourIndex];
  drawRoute(detourRoute.coords, '#ff007f', true); // Color Neón Magenta para los desvíos
}

function cycleNextDetour() {
  if (availableDetours.length <= 1) return;
  currentDetourIndex = (currentDetourIndex + 1) % availableDetours.length;
  renderCurrentDetour();
  showToast(`🔀 Atajo ${currentDetourIndex + 1} de ${availableDetours.length}`);
}

function getDistanceMeters(p1, p2) {
  const R = 6371000;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function drawRoute(coords, color, isDetour) {
  if (isDetour && detourLayer) map.removeLayer(detourLayer);
  if (!isDetour && routeLayer) map.removeLayer(routeLayer);

  const layer = L.polyline(coords, { color: color, weight: isDetour ? 6 : 7, opacity: 0.9 }).addTo(map);

  if (isDetour) detourLayer = layer;
  else routeLayer = layer;
}

function updateNavInfo(routeData) {
  document.getElementById('navPanel').style.display = 'flex';
  document.getElementById('btnStart').style.display = 'block';
  document.getElementById('navDistance').textContent = `${(routeData.distance / 1000).toFixed(1)} km`;
  document.getElementById('navStreet').textContent = 'Ruta Lista';
}

function activateDetour() {
  if (!detourRoute) return;
  drawRoute(detourRoute.coords, '#00f2fe', false);
  if (detourLayer) map.removeLayer(detourLayer);
  currentRoute = detourRoute;
  document.getElementById('btnDetour').style.display = 'none';
  document.getElementById('btnNextDetour').style.display = 'none';
  showToast('Navegando por el atajo seleccionado');
}

function startNavigation() {
  document.getElementById('btnStart').style.display = 'none';
  document.getElementById('btnStop').style.display = 'block';
  showToast('Navegación iniciada');
}

function stopNavigation() {
  document.getElementById('btnStart').style.display = 'block';
  document.getElementById('btnStop').style.display = 'none';
  showToast('Navegación finalizada');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}
