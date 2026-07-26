let map;
let userMarker = null;
let originMarker = null;
let destMarker = null;
let routeLayer = null;

let originCoords = null;
let destCoords = null;

const DEFAULT_ORIGIN = [-31.4201, -64.1888]; // Córdoba

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  getUserLocation();
});

function initMap() {
  // Inicialización limpia
  map = L.map('map', { 
    zoomControl: false,
    attributionControl: false
  }).setView(DEFAULT_ORIGIN, 14);

  // Servidor Esri World Street Map (Rápido, claro y sin bloqueos de API)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(map);

  // Forzar a Leaflet a calcular el tamaño exacto del div
  setTimeout(() => {
    map.invalidateSize();
  }, 200);

  map.on('click', function(e) {
    document.getElementById('suggestions').style.display = 'none';
    closeAllMenus();
    setDestinationFromMap(e.latlng);
  });
}

function getUserLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = [pos.coords.latitude, pos.coords.longitude];
        if (!originCoords) {
          originCoords = latlng;
          document.getElementById('originInput').value = "Mi ubicación actual";
        }
        if (!userMarker) {
          userMarker = L.circleMarker(latlng, {
            radius: 8,
            fillColor: '#2563eb',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 1
          }).addTo(map);
        } else {
          userMarker.setLatLng(latlng);
        }
        map.setView(latlng, 15);
      },
      () => { showToast("⚠️ Sin acceso a GPS"); },
      { enableHighAccuracy: true }
    );
  }
}

function enableSetOriginMode() {
  showToast("📍 Toca el mapa para fijar ORIGEN");
  map.once('click', (e) => {
    originCoords = [e.latlng.lat, e.latlng.lng];
    document.getElementById('originInput').value = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker(e.latlng).addTo(map);
  });
}

function setDestinationFromMap(latlng) {
  destCoords = [latlng.lat, latlng.lng];
  document.getElementById('destInput').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker(latlng).addTo(map);
}

function clearOrigin() {
  originCoords = null;
  document.getElementById('originInput').value = "";
  if (originMarker) map.removeLayer(originMarker);
}

function clearDestination() {
  destCoords = null;
  document.getElementById('destInput').value = "";
  if (destMarker) map.removeLayer(destMarker);
  if (routeLayer) map.removeLayer(routeLayer);
  document.getElementById('navPanel').style.display = 'none';
}

let searchTimeout;
function handleSearchInput(query, type) {
  clearTimeout(searchTimeout);
  const suggestionsBox = document.getElementById('suggestions');
  if (query.length < 3) {
    suggestionsBox.style.display = 'none';
    return;
  }

  searchTimeout = setTimeout(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=4&countrycodes=ar`)
      .then(res => res.json())
      .then(data => {
        suggestionsBox.innerHTML = '';
        if (!data || data.length === 0) {
          suggestionsBox.style.display = 'none';
          return;
        }
        data.forEach(item => {
          const div = document.createElement('div');
          div.className = 'suggestion-item';
          div.innerText = item.display_name;
          div.onclick = () => {
            const latlng = [parseFloat(item.lat), parseFloat(item.lon)];
            if (type === 'origin') {
              originCoords = latlng;
              document.getElementById('originInput').value = item.display_name.split(',')[0];
              if (originMarker) map.removeLayer(originMarker);
              originMarker = L.marker(latlng).addTo(map);
            } else {
              destCoords = latlng;
              document.getElementById('destInput').value = item.display_name.split(',')[0];
              if (destMarker) map.removeLayer(destMarker);
              destMarker = L.marker(latlng).addTo(map);
            }
            suggestionsBox.style.display = 'none';
            map.setView(latlng, 15);
          };
          suggestionsBox.appendChild(div);
        });
        suggestionsBox.style.display = 'block';
      });
  }, 300);
}

function calculateRoute() {
  if (!originCoords || !destCoords) {
    showToast("⚠️ Falta origen o destino");
    return;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${originCoords[1]},${originCoords[0]};${destCoords[1]},${destCoords[0]}?overview=full&geometries=geojson`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

        if (routeLayer) map.removeLayer(routeLayer);
        routeLayer = L.polyline(coords, { color: '#2563eb', weight: 6 }).addTo(map);

        document.getElementById('navDistance').innerText = `${(route.distance / 1000).toFixed(1)} km`;
        document.getElementById('navPanel').style.display = 'flex';
        map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
      } else {
        showToast("❌ No se encontró ruta");
      }
    });
}

function startNavigation() {
  document.getElementById('btnStart').style.display = 'none';
  document.getElementById('btnStop').style.display = 'block';
  showToast("▶️ Navegación iniciada");
}

function stopNavigation() {
  document.getElementById('btnStart').style.display = 'block';
  document.getElementById('btnStop').style.display = 'none';
  showToast("⏹️ Navegación detenida");
}

function toggleMenu(id) {
  const m = document.getElementById(id);
  m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}

function closeAllMenus() {
  document.getElementById('alertOptions').style.display = 'none';
}

function reportIncident(type, label) {
  closeAllMenus();
  showToast(`Reportado: ${label}`);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}
