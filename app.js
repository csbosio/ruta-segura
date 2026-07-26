// Variables Globales
let map;
let userMarker = null;
let originMarker = null;
let destMarker = null;

let routeLayer = null;
let detourLayer = null;

let originCoords = null;
let destCoords = null;

let isNavigating = false;
let watchId = null;
let settingOriginMode = false;

// Coordenadas por defecto (Córdoba, Argentina)
const DEFAULT_ORIGIN = [-31.4201, -64.1888];

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  getUserLocation();
});

// Inicializar Mapa con capa Gris Claro Nativa (CartoDB Positron)
function initMap() {
  map = L.map('map', { 
    zoomControl: false,
    attributionControl: false
  }).setView(DEFAULT_ORIGIN, 14);

  // Servidor de mapas Gris Claro Nativo (CARTO Positron - Sin CSS hacky)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  window.addEventListener('resize', () => {
    map.invalidateSize();
  });

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

// Obtener Ubicación del Usuario
function getUserLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const userLatLng = [lat, lng];

        if (!originCoords) {
          originCoords = userLatLng;
          document.getElementById('originInput').value = "Mi ubicación actual";
        }

        if (!userMarker) {
          userMarker = L.circleMarker(userLatLng, {
            radius: 9,
            fillColor: '#2563eb',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9
          }).addTo(map);
        } else {
          userMarker.setLatLng(userLatLng);
        }

        map.setView(userLatLng, 15);
      },
      (error) => {
        showToast("⚠️ No se pudo obtener la ubicación");
      },
      { enableHighAccuracy: true }
    );
  }
}

// Activar modo fijar origen en mapa
function enableSetOriginMode() {
  settingOriginMode = true;
  showToast("📍 Toca el mapa para fijar el ORIGEN");
}

function setOriginFromMap(latlng) {
  originCoords = [latlng.lat, latlng.lng];
  document.getElementById('originInput').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  
  if (originMarker) map.removeLayer(originMarker);
  originMarker = L.marker(latlng).addTo(map).bindPopup("Origen").openPopup();
}

function setDestinationFromMap(latlng) {
  destCoords = [latlng.lat, latlng.lng];
  document.getElementById('destInput').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker(latlng).addTo(map).bindPopup("Destino").openPopup();
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
  if (detourLayer) map.removeLayer(detourLayer);
  document.getElementById('navPanel').style.display = 'none';
}

// Búsqueda Autocompletada con Nominatim
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
        if (data.length === 0) {
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

// Cálculo de Ruta OSRM
function calculateRoute() {
  if (!originCoords || !destCoords) {
    showToast("⚠️ Ingresá origen y destino");
    return;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${originCoords[1]},${originCoords[0]};${destCoords[1]},${destCoords[0]}?overview=full&geometries=geojson`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

        drawRoute(coords, '#2563eb', false); // Ruta en Azul Intenso

        const distanceKm = (route.distance / 1000).toFixed(1);
        document.getElementById('navDistance').innerText = `${distanceKm} km`;
        document.getElementById('navPanel').style.display = 'flex';

        map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
      } else {
        showToast("❌ No se encontró ruta");
      }
    });
}

function drawRoute(coords, color, isDetour) {
  if (isDetour && detourLayer) map.removeLayer(detourLayer);
  if (!isDetour && routeLayer) map.removeLayer(routeLayer);

  const layer = L.polyline(coords, { color: color, weight: 7, opacity: 0.9 }).addTo(map);

  if (isDetour) detourLayer = layer;
  else routeLayer = layer;
}

// Control de Navegación GPS
function startNavigation() {
  isNavigating = true;
  document.getElementById('btnStart').style.display = 'none';
  document.getElementById('btnStop').style.display = 'block';
  showToast("▶️ Navegación iniciada");

  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition((pos) => {
      const userLatLng = [pos.coords.latitude, pos.coords.longitude];
      if (userMarker) userMarker.setLatLng(userLatLng);
      map.setView(userLatLng, 17);
    }, null, { enableHighAccuracy: true });
  }
}

function stopNavigation() {
  isNavigating = false;
  document.getElementById('btnStart').style.display = 'block';
  document.getElementById('btnStop').style.display = 'none';
  if (watchId) navigator.geolocation.clearWatch(watchId);
  showToast("⏹️ Navegación detenida");
}

// Gestión de Menús y Alertas
function toggleMenu(menuId) {
  const menu = document.getElementById(menuId);
  const isVisible = menu.style.display === 'flex';
  closeAllMenus();
  menu.style.display = isVisible ? 'none' : 'flex';
}

function closeAllMenus() {
  document.getElementById('alertOptions').style.display = 'none';
  document.getElementById('hornOptions').style.display = 'none';
}

function reportIncident(type, label) {
  closeAllMenus();
  showToast(`Aviso enviado: ${label}`);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}
