(function () {
  "use strict";

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    try {
      const requested = typeof args[0] === "string" ? args[0] : args[0].url;
      if (/\/route\.geojson(?:\?|$)/.test(requested)) {
        response.clone().json().then((geojson) => {
          const coordinates = extractCoordinates(geojson);
          if (coordinates.length > 1) {
            window.__CANFRANC_ACTIVE_ROUTE__ = {
              coordinates,
              url: new URL(requested, location.href).href,
              name: decodeURIComponent(new URL(requested, location.href).pathname.split("/").slice(-2, -1)[0] || "Ruta")
            };
            window.dispatchEvent(new CustomEvent("canfranc-route-ready"));
          }
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  function extractCoordinates(data) {
    const lines = [];
    const visit = (geometry) => {
      if (!geometry) return;
      if (geometry.type === "LineString") lines.push(geometry.coordinates);
      if (geometry.type === "MultiLineString") geometry.coordinates.forEach((line) => lines.push(line));
      if (geometry.type === "GeometryCollection") geometry.geometries.forEach(visit);
    };
    if (data.type === "FeatureCollection") data.features.forEach((feature) => visit(feature.geometry));
    else if (data.type === "Feature") visit(data.geometry);
    else visit(data);
    return lines.reduce((all, line, index) => all.concat(index ? [line[0], ...line.slice(1)] : line), []);
  }

  let installPrompt = null;
  let watchId = null;
  let wakeLock = null;
  let offRouteCount = 0;
  let lastVibration = 0;
  let navigationActive = false;
  let ui;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    if (ui) ui.install.hidden = false;
  });

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    buildUi();
    registerServiceWorker();
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("canfranc-route-ready", updateRouteState);
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && navigationActive) await requestWakeLock();
    });
  }

  function buildUi() {
    const launcher = document.createElement("button");
    launcher.className = "offline-nav-launcher";
    launcher.type = "button";
    launcher.textContent = "GPS · Offline";
    launcher.setAttribute("aria-label", "Abrir navegación GPS sin cobertura");

    const panel = document.createElement("section");
    panel.className = "offline-nav-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Navegación GPS offline");
    panel.innerHTML = `
      <div class="offline-nav-head">
        <h2 class="offline-nav-title">Navegación offline</h2>
        <button class="offline-nav-close" type="button" aria-label="Cerrar">×</button>
      </div>
      <div class="offline-nav-state" data-level="warn" role="status" aria-live="polite">Abre el mapa 3D de una ruta para comenzar.</div>
      <div class="offline-nav-grid">
        <div class="offline-nav-metric"><small>Ruta</small><strong data-metric="route">Sin seleccionar</strong></div>
        <div class="offline-nav-metric"><small>Conexión</small><strong data-metric="network">—</strong></div>
        <div class="offline-nav-metric"><small>Distancia al camino</small><strong data-metric="distance">—</strong></div>
        <div class="offline-nav-metric"><small>Precisión GPS</small><strong data-metric="accuracy">—</strong></div>
        <div class="offline-nav-metric"><small>Falta aprox.</small><strong data-metric="remaining">—</strong></div>
        <div class="offline-nav-metric"><small>Pantalla activa</small><strong data-metric="wake">No</strong></div>
      </div>
      <div class="offline-nav-actions">
        <button class="offline-nav-button" type="button" data-action="prepare">Preparar app sin cobertura</button>
        <progress class="offline-nav-progress" max="100" value="0" hidden></progress>
        <button class="offline-nav-button" type="button" data-action="start">Iniciar navegación GPS</button>
        <button class="offline-nav-button danger" type="button" data-action="stop" hidden>Detener navegación</button>
        <button class="offline-nav-button secondary" type="button" data-action="install" hidden>Instalar en el móvil</button>
      </div>
      <p class="offline-nav-note">Antes de salir, abre la ruta y pulsa “Preparar”. El GPS funciona sin cobertura. El mapa base 3D completo necesita un paquete cartográfico local adicional.</p>`;

    document.body.append(launcher, panel);
    ui = {
      launcher,
      panel,
      close: panel.querySelector(".offline-nav-close"),
      state: panel.querySelector(".offline-nav-state"),
      route: panel.querySelector('[data-metric="route"]'),
      network: panel.querySelector('[data-metric="network"]'),
      distance: panel.querySelector('[data-metric="distance"]'),
      accuracy: panel.querySelector('[data-metric="accuracy"]'),
      remaining: panel.querySelector('[data-metric="remaining"]'),
      wake: panel.querySelector('[data-metric="wake"]'),
      prepare: panel.querySelector('[data-action="prepare"]'),
      progress: panel.querySelector("progress"),
      start: panel.querySelector('[data-action="start"]'),
      stop: panel.querySelector('[data-action="stop"]'),
      install: panel.querySelector('[data-action="install"]')
    };
    launcher.addEventListener("click", () => togglePanel(true));
    ui.close.addEventListener("click", () => togglePanel(false));
    ui.prepare.addEventListener("click", prepareOffline);
    ui.start.addEventListener("click", startNavigation);
    ui.stop.addEventListener("click", stopNavigation);
    ui.install.addEventListener("click", installApp);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    ui.install.hidden = standalone;
    updateRouteState();
  }

  function togglePanel(open) {
    ui.panel.hidden = !open;
    ui.launcher.hidden = open;
  }

  function setState(message, level = "ok") {
    ui.state.textContent = message;
    ui.state.dataset.level = level;
  }

  function updateConnection() {
    if (!ui) return;
    ui.network.textContent = navigator.onLine ? "Con cobertura" : "Sin cobertura";
  }

  function updateRouteState() {
    const route = window.__CANFRANC_ACTIVE_ROUTE__;
    ui.route.textContent = route ? route.name.replaceAll("-", " ") : "Sin seleccionar";
    if (route && !navigationActive) setState("Ruta cargada. Ya puedes preparar el modo offline o iniciar el GPS.", "ok");
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      setState("Este navegador no admite instalación offline.", "danger");
      ui.prepare.disabled = true;
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener("message", handleWorkerMessage);
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      setState("No se pudo activar el modo offline: " + error.message, "danger");
    }
  }

  async function prepareOffline() {
    if (!("serviceWorker" in navigator)) return;
    ui.prepare.disabled = true;
    ui.progress.hidden = false;
    ui.progress.value = 1;
    setState("Guardando aplicación y los 20 trazados…", "warn");
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active || navigator.serviceWorker.controller;
      if (!worker) throw new Error("servicio offline aún no disponible");
      worker.postMessage({ type: "CACHE_ALL" });
    } catch (error) {
      ui.prepare.disabled = false;
      setState("No se pudo preparar: " + error.message, "danger");
    }
  }

  function handleWorkerMessage(event) {
    const data = event.data || {};
    if (data.type === "CACHE_PROGRESS") {
      ui.progress.value = Math.round((data.done / data.total) * 100);
    }
    if (data.type === "CACHE_COMPLETE") {
      ui.progress.value = 100;
      ui.prepare.disabled = false;
      ui.prepare.textContent = "Contenido offline preparado ✓";
      setState(`Aplicación y ${data.cached} archivos guardados. Haz una prueba en modo avión antes de salir.`, "ok");
    }
    if (data.type === "CACHE_ERROR") {
      ui.prepare.disabled = false;
      setState("Guardado parcial. Conéctate a una red estable y vuelve a pulsar Preparar.", "danger");
    }
  }

  async function installApp() {
    if (!installPrompt) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      setState(isIOS
        ? "En iPhone: pulsa Compartir y después “Añadir a pantalla de inicio”. Ábrela desde ese icono."
        : "Abre el menú del navegador y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.", "warn");
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    ui.install.hidden = true;
  }

  async function startNavigation() {
    const route = window.__CANFRANC_ACTIVE_ROUTE__;
    if (!route) {
      setState("Primero entra en una ruta y abre su mapa 3D para cargar el camino.", "warn");
      return;
    }
    if (!("geolocation" in navigator)) {
      setState("Este dispositivo no ofrece GPS al navegador.", "danger");
      return;
    }
    navigationActive = true;
    offRouteCount = 0;
    ui.start.hidden = true;
    ui.stop.hidden = false;
    await requestWakeLock();
    setState("Solicitando una posición GPS precisa…", "warn");
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000
    });
    setTimeout(() => {
      const geolocate = document.querySelector(".maplibregl-ctrl-geolocate");
      if (geolocate && !geolocate.classList.contains("maplibregl-ctrl-geolocate-active")) geolocate.click();
    }, 300);
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      ui.wake.textContent = "No compatible";
      return;
    }
    try {
      if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock.request("screen");
      ui.wake.textContent = "Sí";
      wakeLock.addEventListener("release", () => { if (ui) ui.wake.textContent = "No"; }, { once: true });
    } catch (_) {
      ui.wake.textContent = "Bloqueada";
    }
  }

  function onPosition(position) {
    const route = window.__CANFRANC_ACTIVE_ROUTE__;
    if (!route) return;
    const point = [position.coords.longitude, position.coords.latitude];
    const nearest = nearestOnRoute(point, route.coordinates);
    const accuracy = Math.round(position.coords.accuracy || 0);
    const threshold = Math.max(50, accuracy * 1.5);
    ui.distance.textContent = formatDistance(nearest.distance);
    ui.accuracy.textContent = `± ${accuracy} m`;
    ui.remaining.textContent = formatDistance(Math.max(0, nearest.total - nearest.along));

    if (position.coords.accuracy > 80) {
      offRouteCount = 0;
      setState("Señal GPS débil. Espera a que la precisión mejore antes de decidir el camino.", "warn");
      return;
    }
    if (nearest.distance > threshold) offRouteCount += 1;
    else offRouteCount = 0;

    if (offRouteCount >= 3) {
      setState(`Atención: estás a ${formatDistance(nearest.distance)} del trazado. Revisa el mapa y vuelve al punto seguro más cercano.`, "danger");
      const now = Date.now();
      if (navigator.vibrate && now - lastVibration > 30000) {
        navigator.vibrate([300, 150, 300, 150, 600]);
        lastVibration = now;
      }
    } else {
      setState(`GPS activo · posición recibida a las ${new Date(position.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`, "ok");
    }
  }

  function onPositionError(error) {
    const messages = {
      1: "Permiso GPS denegado. Actívalo en los permisos del navegador.",
      2: "No se obtiene posición. Sal a una zona con más cielo visible.",
      3: "El GPS está tardando demasiado. Déjalo activo y vuelve a intentarlo."
    };
    setState(messages[error.code] || "Error GPS: " + error.message, "danger");
  }

  async function stopNavigation() {
    navigationActive = false;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (wakeLock && !wakeLock.released) await wakeLock.release().catch(() => {});
    wakeLock = null;
    ui.start.hidden = false;
    ui.stop.hidden = true;
    ui.wake.textContent = "No";
    setState("Navegación detenida.", "warn");
  }

  function nearestOnRoute(point, coordinates) {
    let best = { distance: Infinity, along: 0, total: 0 };
    let traversed = 0;
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const a = coordinates[i];
      const b = coordinates[i + 1];
      const segment = projectToSegment(point, a, b);
      const segmentLength = distanceMeters(a, b);
      if (segment.distance < best.distance) best = { distance: segment.distance, along: traversed + segmentLength * segment.t, total: 0 };
      traversed += segmentLength;
    }
    best.total = traversed;
    return best;
  }

  function projectToSegment(point, a, b) {
    const latitude = point[1] * Math.PI / 180;
    const xScale = 111320 * Math.cos(latitude);
    const yScale = 110540;
    const ax = (a[0] - point[0]) * xScale;
    const ay = (a[1] - point[1]) * yScale;
    const bx = (b[0] - point[0]) * xScale;
    const by = (b[1] - point[1]) * yScale;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    return { distance: Math.hypot(ax + t * dx, ay + t * dy), t };
  }

  function distanceMeters(a, b) {
    const radius = 6371000;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  }
})();
