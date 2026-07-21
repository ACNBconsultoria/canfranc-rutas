(function () {
  "use strict";

  const DB_NAME = "canfranc-rutas-user-data";
  const DB_VERSION = 1;
  const ACTIVE_DRAFT_ID = "active";
  const state = {
    db: null,
    client: null,
    session: null,
    profile: null,
    recording: null,
    localActivities: [],
    remoteActivities: [],
    communityPosts: [],
    communityLoading: false,
    activeTab: "profile",
    ui: null
  };
  let initialized = false;

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("online", () => syncPendingActivities());
  window.addEventListener("canfranc-gps-position", (event) => recordPosition(event.detail));

  async function init() {
    if (initialized) return;
    initialized = true;
    state.db = await openDatabase();
    state.recording = await dbGet("drafts", ACTIVE_DRAFT_ID);
    state.localActivities = await dbGetAll("activities");
    buildUi();
    connectSupabase();
    renderAll();
  }

  function connectSupabase() {
    const config = window.CANFRANC_SUPABASE_CONFIG || {};
    const configured = /^https:\/\//.test(config.url || "") && (config.publishableKey || "").length > 20;
    if (!configured || !window.supabase?.createClient) return;

    state.client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    state.client.auth.getSession().then(({ data }) => setSession(data.session));
    state.client.auth.onAuthStateChange((_event, session) => setSession(session));
  }

  async function setSession(session) {
    state.session = session;
    state.profile = null;
    state.remoteActivities = [];
    if (session) {
      await Promise.all([loadProfile(), loadRemoteActivities()]);
      await syncPendingActivities();
    }
    await loadCommunity();
    renderAll();
  }

  function buildUi() {
    const launcher = document.createElement("button");
    launcher.className = "account-launcher";
    launcher.type = "button";
    launcher.textContent = "Mi cuenta · Actividades";

    const panel = document.createElement("section");
    panel.className = "account-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Cuenta, actividades y comunidad");
    panel.innerHTML = `
      <header class="account-head">
        <h2>Mi espacio senderista</h2>
        <button class="account-close" type="button" aria-label="Cerrar">×</button>
      </header>
      <nav class="account-tabs" aria-label="Secciones">
        <button class="account-tab" type="button" data-tab="profile">Mi cuenta</button>
        <button class="account-tab" type="button" data-tab="record">Grabar ruta</button>
        <button class="account-tab" type="button" data-tab="history">Historial</button>
        <button class="account-tab" type="button" data-tab="community">Comunidad</button>
      </nav>
      <main class="account-content">
        <div class="account-alert" hidden role="status" aria-live="polite"></div>
        <section class="account-view" data-view="profile"></section>
        <section class="account-view" data-view="record" hidden></section>
        <section class="account-view" data-view="history" hidden></section>
        <section class="account-view" data-view="community" hidden></section>
      </main>`;

    document.body.append(launcher, panel);
    state.ui = {
      launcher,
      panel,
      close: panel.querySelector(".account-close"),
      tabs: [...panel.querySelectorAll("[data-tab]")],
      views: [...panel.querySelectorAll("[data-view]")],
      alert: panel.querySelector(".account-alert")
    };

    launcher.addEventListener("click", () => togglePanel(true));
    state.ui.close.addEventListener("click", () => togglePanel(false));
    state.ui.tabs.forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
    panel.addEventListener("submit", handleSubmit);
    panel.addEventListener("click", handleClick);
  }

  function togglePanel(open) {
    state.ui.panel.hidden = !open;
    state.ui.launcher.hidden = open;
    if (open) renderAll();
  }

  function selectTab(tab) {
    state.activeTab = tab;
    renderAll();
  }

  function renderAll() {
    if (!state.ui) return;
    state.ui.tabs.forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === state.activeTab)));
    state.ui.views.forEach((view) => { view.hidden = view.dataset.view !== state.activeTab; });
    renderProfile();
    renderRecorder();
    renderHistory();
    renderCommunity();
  }

  function renderProfile() {
    const view = getView("profile");
    if (!state.client) {
      view.innerHTML = `
        <div class="account-card">
          <h3>Cuenta todavía sin conectar</h3>
          <p>La grabación y el historial local ya pueden funcionar. Para crear cuentas y sincronizar datos falta conectar el proyecto de Supabase.</p>
          <p class="account-muted">Hasta entonces, las actividades permanecerán únicamente en este dispositivo.</p>
        </div>
        ${localStatsHtml()}`;
      return;
    }

    if (!state.session) {
      view.innerHTML = `
        <div class="account-card">
          <h3>Iniciar sesión</h3>
          <form class="account-form" data-form="signin">
            <div class="account-field"><label>Correo electrónico</label><input name="email" type="email" autocomplete="email" required></div>
            <div class="account-field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" minlength="8" required></div>
            <button class="account-button" type="submit">Entrar</button>
          </form>
        </div>
        <div class="account-card">
          <h3>Crear una cuenta</h3>
          <form class="account-form" data-form="signup">
            <div class="account-field"><label>Nombre público</label><input name="display_name" minlength="2" maxlength="60" required></div>
            <div class="account-field"><label>Correo electrónico</label><input name="email" type="email" autocomplete="email" required></div>
            <div class="account-field"><label>Contraseña</label><input name="password" type="password" autocomplete="new-password" minlength="8" required></div>
            <button class="account-button" type="submit">Crear cuenta</button>
          </form>
        </div>
        ${localStatsHtml()}`;
      return;
    }

    const profile = state.profile || {};
    view.innerHTML = `
      <div class="account-card">
        <h3>${escapeHtml(profile.display_name || state.session.user.email || "Senderista")}</h3>
        <p class="account-muted">${escapeHtml(state.session.user.email || "")}</p>
        <form class="account-form" data-form="profile">
          <div class="account-form two">
            <div class="account-field"><label>Nombre público</label><input name="display_name" value="${escapeAttr(profile.display_name || "")}" minlength="2" maxlength="60" required></div>
            <div class="account-field"><label>Usuario</label><input name="username" value="${escapeAttr(profile.username || "")}" pattern="[a-z0-9_]{3,24}" placeholder="nombre_senderista"></div>
          </div>
          <div class="account-field"><label>Biografía</label><textarea name="bio" maxlength="300">${escapeHtml(profile.bio || "")}</textarea></div>
          <div class="account-actions">
            <button class="account-button" type="submit">Guardar perfil</button>
            <button class="account-button secondary" type="button" data-action="sync">Sincronizar pendientes</button>
            <button class="account-button danger" type="button" data-action="signout">Cerrar sesión</button>
          </div>
        </form>
      </div>
      ${profileStatsHtml(profile)}`;
  }

  function localStatsHtml() {
    const activities = state.localActivities;
    const distance = activities.reduce((sum, item) => sum + (item.distance_m || 0), 0);
    const ascent = activities.reduce((sum, item) => sum + (item.ascent_m || 0), 0);
    const completed = new Set(activities.filter((item) => item.completed).map((item) => item.route_id)).size;
    return `<div class="account-card"><h3>Datos en este dispositivo</h3><div class="account-stats">
      <div class="account-stat"><small>Distancia</small><strong>${formatDistance(distance)}</strong></div>
      <div class="account-stat"><small>Desnivel +</small><strong>${Math.round(ascent)} m</strong></div>
      <div class="account-stat"><small>Rutas completadas</small><strong>${completed}</strong></div>
    </div></div>`;
  }

  function profileStatsHtml(profile) {
    return `<div class="account-card"><h3>Resumen sincronizado</h3><div class="account-stats">
      <div class="account-stat"><small>Distancia</small><strong>${formatDistance(profile.total_distance_m || 0)}</strong></div>
      <div class="account-stat"><small>Desnivel +</small><strong>${Math.round(profile.total_ascent_m || 0)} m</strong></div>
      <div class="account-stat"><small>Rutas completadas</small><strong>${profile.completed_routes || 0}</strong></div>
    </div></div>`;
  }

  function renderRecorder() {
    const view = getView("record");
    const route = window.__CANFRANC_ACTIVE_ROUTE__;
    const record = state.recording;
    if (!record) {
      view.innerHTML = `
        <div class="account-card">
          <h3>Nueva actividad</h3>
          <p>Ruta seleccionada: <strong>${route ? escapeHtml(prettyRoute(route.name)) : "ninguna"}</strong></p>
          <p class="account-muted">Abre el mapa 3D de la ruta antes de comenzar. La actividad se guardará en el móvil aunque no haya cobertura.</p>
          <div class="account-actions"><button class="account-button" type="button" data-action="start-record" ${route ? "" : "disabled"}>Comenzar actividad</button></div>
        </div>`;
      return;
    }

    const elapsed = effectiveElapsed(record);
    const pace = record.distance_m > 50 && record.moving_seconds > 0 ? record.moving_seconds / (record.distance_m / 1000) : null;
    view.innerHTML = `
      <div class="account-card">
        <div class="record-state ${record.paused ? "" : "active"}">${record.paused ? "Actividad pausada" : "Grabando actividad"}</div>
        <h3>${escapeHtml(prettyRoute(record.route_name))}</h3>
        <div class="record-live">
          <div class="account-stat"><small>Tiempo</small><strong>${formatDuration(elapsed)}</strong></div>
          <div class="account-stat"><small>Distancia</small><strong>${formatDistance(record.distance_m)}</strong></div>
          <div class="account-stat"><small>Ritmo</small><strong>${formatPace(pace)}</strong></div>
          <div class="account-stat"><small>Desnivel +</small><strong>${Math.round(record.ascent_m)} m</strong></div>
          <div class="account-stat"><small>Progreso estimado</small><strong>${Math.round(record.max_progress * 100)}%</strong></div>
        </div>
        <div class="account-actions">
          <button class="account-button secondary" type="button" data-action="toggle-pause">${record.paused ? "Continuar" : "Pausar"}</button>
          <button class="account-button danger" type="button" data-action="finish-record">Finalizar y guardar</button>
        </div>
      </div>`;
  }

  function renderHistory() {
    const view = getView("history");
    const all = mergeActivities();
    if (!all.length) {
      view.innerHTML = `<div class="community-empty">Todavía no hay actividades guardadas.</div>`;
      return;
    }
    view.innerHTML = `<div class="account-card"><h3>Mis actividades</h3><div class="activity-list">${all.map(activityHtml).join("")}</div></div>`;
  }

  function activityHtml(item) {
    return `<article class="activity-item">
      <div class="activity-item-head"><h4>${escapeHtml(item.title || prettyRoute(item.route_id))}</h4><span class="sync-badge ${item.sync_status === "synced" || item.id ? "synced" : ""}">${item.sync_status === "synced" || item.id ? "Sincronizada" : "Pendiente"}</span></div>
      <div class="activity-meta">
        <span>${new Date(item.started_at).toLocaleDateString("es-ES")}</span>
        <span>${formatDuration(item.elapsed_seconds || 0)}</span>
        <span>${formatDistance(item.distance_m || 0)}</span>
        <span>+${Math.round(item.ascent_m || 0)} m</span>
        <span>${item.completed ? "Completada" : `${Math.round(item.completion_percentage || 0)}%`}</span>
      </div>
    </article>`;
  }

  function renderCommunity() {
    const view = getView("community");
    if (!state.client) {
      view.innerHTML = `<div class="account-card"><h3>Comunidad preparada para la conexión</h3><p>Este apartado se activará al conectar Supabase. Aquí aparecerán publicaciones, fotografías, comentarios y valoraciones de otros senderistas.</p></div>`;
      return;
    }
    const composer = state.session ? communityComposerHtml() : `<div class="account-card"><p>Inicia sesión para publicar fotografías, comentar y dar “me gusta”.</p></div>`;
    const feed = state.communityLoading
      ? `<div class="community-empty">Cargando publicaciones…</div>`
      : state.communityPosts.length
        ? `<div class="activity-list">${state.communityPosts.map(postHtml).join("")}</div>`
        : `<div class="community-empty">Todavía no hay publicaciones. La primera ruta puede ser la tuya.</div>`;
    view.innerHTML = `${composer}${feed}`;
  }

  function communityComposerHtml() {
    const activities = state.remoteActivities.filter((item) => item.completed);
    return `<div class="account-card">
      <h3>Compartir una experiencia</h3>
      <form class="account-form" data-form="post">
        <div class="account-field"><label>Actividad realizada</label><select name="activity_id"><option value="">Publicación general</option>${activities.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.title)} · ${new Date(item.started_at).toLocaleDateString("es-ES")}</option>`).join("")}</select></div>
        <div class="account-field"><label>Impresiones, recomendaciones o estado del camino</label><textarea name="body" maxlength="2000" required></textarea></div>
        <div class="account-field"><label>Fotografías (máximo 4)</label><input name="photos" type="file" accept="image/*" multiple></div>
        <button class="account-button" type="submit">Publicar</button>
      </form>
    </div>`;
  }

  function postHtml(post) {
    const profile = post.profile || {};
    const activity = post.activity;
    const ownLike = state.session && (post.likes || []).some((like) => like.user_id === state.session.user.id);
    const media = (post.media || []).map((item) => {
      const url = state.client.storage.from("community-media").getPublicUrl(item.storage_path).data.publicUrl;
      return `<img src="${escapeAttr(url)}" alt="Fotografía compartida por ${escapeAttr(profile.display_name || "senderista")}" loading="lazy">`;
    }).join("");
    const comments = (post.comments || []).map((comment) => `<div class="community-comment"><strong>${escapeHtml(comment.profile?.display_name || comment.profile?.username || "Senderista")}</strong> ${escapeHtml(comment.body)}</div>`).join("");
    return `<article class="account-card community-post">
      <div class="activity-item-head"><div><strong>${escapeHtml(profile.display_name || profile.username || "Senderista")}</strong><div class="account-muted">${new Date(post.created_at).toLocaleString("es-ES")}</div></div></div>
      ${activity ? `<div class="community-route"><strong>${escapeHtml(activity.title)}</strong><span>${formatDistance(activity.distance_m || 0)} · +${Math.round(activity.ascent_m || 0)} m · ${formatDuration(activity.elapsed_seconds || 0)}</span></div>` : ""}
      <p>${escapeHtml(post.body).replace(/\n/g, "<br>")}</p>
      ${media ? `<div class="community-gallery">${media}</div>` : ""}
      <div class="account-actions">
        <button class="account-button secondary" type="button" data-action="toggle-like" data-post-id="${post.id}">${ownLike ? "♥" : "♡"} ${(post.likes || []).length}</button>
      </div>
      <div class="community-comments">${comments}</div>
      ${state.session ? `<form class="community-comment-form" data-form="comment" data-post-id="${post.id}"><input name="body" maxlength="600" placeholder="Escribe un comentario" required><button class="account-button secondary" type="submit">Enviar</button></form>` : ""}
    </article>`;
  }

  async function handleSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try {
      if (form.dataset.form === "signin") {
        const { error } = await state.client.auth.signInWithPassword({ email: values.email, password: values.password });
        if (error) throw error;
        showAlert("Sesión iniciada.", "ok");
      }
      if (form.dataset.form === "signup") {
        const { error } = await state.client.auth.signUp({
          email: values.email,
          password: values.password,
          options: { data: { display_name: values.display_name } }
        });
        if (error) throw error;
        showAlert("Cuenta creada. Revisa el correo si se solicita confirmación.", "ok");
      }
      if (form.dataset.form === "profile") {
        const payload = {
          display_name: values.display_name.trim(),
          username: values.username.trim().toLowerCase() || null,
          bio: values.bio.trim() || null
        };
        const { error } = await state.client.from("profiles").update(payload).eq("id", state.session.user.id);
        if (error) throw error;
        await loadProfile();
        showAlert("Perfil guardado.", "ok");
        renderAll();
      }
      if (form.dataset.form === "post") await createPost(form);
      if (form.dataset.form === "comment") await createComment(form.dataset.postId, values.body);
    } catch (error) {
      showAlert(normalizeError(error), "danger");
    }
  }

  async function handleClick(event) {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "signout") await state.client.auth.signOut();
    if (action === "sync") await syncPendingActivities(true);
    if (action === "start-record") await startRecording();
    if (action === "toggle-pause") await togglePause();
    if (action === "finish-record") await finishRecording();
    if (action === "toggle-like") await toggleLike(event.target.closest("[data-post-id]").dataset.postId);
  }

  async function startRecording() {
    const route = window.__CANFRANC_ACTIVE_ROUTE__;
    if (!route) return showAlert("Primero abre el mapa 3D de una ruta.", "danger");
    const now = Date.now();
    state.recording = {
      id: ACTIVE_DRAFT_ID,
      client_id: crypto.randomUUID(),
      route_id: route.name,
      route_name: route.name,
      started_at_ms: now,
      paused: false,
      paused_at_ms: null,
      paused_duration_ms: 0,
      points: [],
      distance_m: 0,
      moving_seconds: 0,
      ascent_m: 0,
      descent_m: 0,
      min_elevation_m: null,
      max_elevation_m: null,
      smoothed_altitude_m: null,
      elevation_anchor_m: null,
      max_progress: 0,
      last_distance_to_route_m: null
    };
    await dbPut("drafts", state.recording);
    window.dispatchEvent(new CustomEvent("canfranc-navigation-request-start"));
    showAlert("Actividad iniciada y protegida en el almacenamiento local.", "ok");
    renderAll();
  }

  async function togglePause() {
    const record = state.recording;
    if (!record) return;
    const now = Date.now();
    if (record.paused) {
      record.paused_duration_ms += Math.max(0, now - record.paused_at_ms);
      record.paused = false;
      record.paused_at_ms = null;
    } else {
      record.paused = true;
      record.paused_at_ms = now;
    }
    await dbPut("drafts", record);
    renderAll();
  }

  async function recordPosition(position) {
    const record = state.recording;
    if (!record || record.paused || !position) return;
    if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return;
    if (Number(position.accuracy || 999) > 100) return;

    const point = {
      longitude: position.longitude,
      latitude: position.latitude,
      altitude: Number.isFinite(position.altitude) ? position.altitude : null,
      accuracy: position.accuracy,
      timestamp: position.timestamp || Date.now()
    };
    const previous = record.points[record.points.length - 1];
    if (previous) {
      const seconds = Math.max(0, (point.timestamp - previous.timestamp) / 1000);
      const distance = haversine(previous, point);
      const speed = seconds > 0 ? distance / seconds : 0;
      if (seconds < 1 || speed > 15) return;
      record.distance_m += distance;
      if (speed >= 0.35 && seconds <= 120) record.moving_seconds += seconds;
    }

    updateElevation(record, point.altitude);
    record.max_progress = Math.max(record.max_progress, position.routeTotal > 0 ? position.routeAlong / position.routeTotal : 0);
    record.last_distance_to_route_m = position.distanceToRoute;
    record.route_total_m = position.routeTotal;
    record.points.push(point);
    await dbPut("drafts", record);
    if (!state.ui.panel.hidden && state.activeTab === "record") renderRecorder();
  }

  function updateElevation(record, altitude) {
    if (!Number.isFinite(altitude)) return;
    record.min_elevation_m = record.min_elevation_m === null ? altitude : Math.min(record.min_elevation_m, altitude);
    record.max_elevation_m = record.max_elevation_m === null ? altitude : Math.max(record.max_elevation_m, altitude);
    record.smoothed_altitude_m = record.smoothed_altitude_m === null ? altitude : record.smoothed_altitude_m * 0.75 + altitude * 0.25;
    if (record.elevation_anchor_m === null) record.elevation_anchor_m = record.smoothed_altitude_m;
    const difference = record.smoothed_altitude_m - record.elevation_anchor_m;
    if (Math.abs(difference) >= 3) {
      if (difference > 0) record.ascent_m += difference;
      else record.descent_m += Math.abs(difference);
      record.elevation_anchor_m = record.smoothed_altitude_m;
    }
  }

  async function finishRecording() {
    const record = state.recording;
    if (!record) return;
    if (record.points.length < 2) return showAlert("Aún no hay suficientes posiciones GPS para guardar la actividad.", "danger");
    const ended = Date.now();
    const elapsed = effectiveElapsed(record, ended);
    const completion = Math.max(0, Math.min(100, record.max_progress * 100));
    const completed = completion >= 85 || (
      record.route_total_m > 0 && record.distance_m >= record.route_total_m * 0.8 && record.last_distance_to_route_m <= 150
    );
    const activity = {
      client_id: record.client_id,
      route_id: record.route_id,
      title: prettyRoute(record.route_name),
      started_at: new Date(record.started_at_ms).toISOString(),
      ended_at: new Date(ended).toISOString(),
      elapsed_seconds: Math.round(elapsed),
      moving_seconds: Math.round(record.moving_seconds),
      distance_m: Math.round(record.distance_m * 10) / 10,
      ascent_m: Math.round(record.ascent_m * 10) / 10,
      descent_m: Math.round(record.descent_m * 10) / 10,
      avg_pace_seconds_km: record.distance_m > 50 ? Math.round(record.moving_seconds / (record.distance_m / 1000)) : null,
      min_elevation_m: record.min_elevation_m,
      max_elevation_m: record.max_elevation_m,
      completion_percentage: Math.round(completion * 100) / 100,
      completed,
      source: "gps",
      visibility: "private",
      notes: null,
      start_location: locationJson(record.points[0]),
      end_location: locationJson(record.points[record.points.length - 1]),
      track_geojson: {
        type: "Feature",
        properties: { timestamps: record.points.map((point) => point.timestamp), accuracy: record.points.map((point) => point.accuracy) },
        geometry: { type: "LineString", coordinates: record.points.map((point) => point.altitude === null ? [point.longitude, point.latitude] : [point.longitude, point.latitude, point.altitude]) }
      },
      sync_status: "pending",
      saved_at: new Date().toISOString()
    };
    await dbPut("activities", activity);
    await dbDelete("drafts", ACTIVE_DRAFT_ID);
    state.recording = null;
    state.localActivities = await dbGetAll("activities");
    window.dispatchEvent(new CustomEvent("canfranc-navigation-request-stop"));
    showAlert(completed ? "Actividad guardada y ruta marcada como completada." : "Actividad guardada. El recorrido no alcanza todavía el mínimo para marcar la ruta como completada.", "ok");
    state.activeTab = "history";
    renderAll();
    await syncPendingActivities();
  }

  async function syncPendingActivities(notify = false) {
    if (!state.client || !state.session || !navigator.onLine) {
      if (notify) showAlert("No se puede sincronizar todavía: revisa la sesión y la conexión.", "danger");
      return;
    }
    const pending = (await dbGetAll("activities")).filter((item) => item.sync_status !== "synced");
    let synced = 0;
    for (const item of pending) {
      const payload = { ...item, user_id: state.session.user.id };
      delete payload.sync_status;
      delete payload.saved_at;
      const { error } = await state.client.from("activities").upsert(payload, { onConflict: "user_id,client_id" });
      if (!error) {
        item.sync_status = "synced";
        await dbPut("activities", item);
        synced += 1;
      }
    }
    state.localActivities = await dbGetAll("activities");
    if (synced) await Promise.all([loadProfile(), loadRemoteActivities()]);
    if (notify) showAlert(synced ? `${synced} actividades sincronizadas.` : "No había actividades pendientes.", "ok");
    renderAll();
  }

  async function loadProfile() {
    if (!state.client || !state.session) return;
    const { data, error } = await state.client.from("profiles").select("*").eq("id", state.session.user.id).single();
    if (!error) state.profile = data;
  }

  async function loadRemoteActivities() {
    if (!state.client || !state.session) return;
    const { data, error } = await state.client.from("activities").select("id,client_id,route_id,title,started_at,elapsed_seconds,moving_seconds,distance_m,ascent_m,completion_percentage,completed,visibility").eq("user_id", state.session.user.id).order("started_at", { ascending: false }).limit(100);
    if (!error) state.remoteActivities = data || [];
  }

  async function loadCommunity() {
    if (!state.client) return;
    state.communityLoading = true;
    renderCommunity();
    const { data, error } = await state.client
      .from("posts")
      .select(`
        id,user_id,activity_id,body,created_at,
        profile:profiles!posts_user_id_fkey(display_name,username,avatar_url),
        activity:activities!posts_activity_id_fkey(id,title,route_id,distance_m,ascent_m,elapsed_seconds),
        media:post_media(id,storage_path,mime_type,width,height),
        likes(user_id),
        comments(id,user_id,body,created_at,profile:profiles!comments_user_id_fkey(display_name,username))
      `)
      .order("created_at", { ascending: false })
      .limit(30);
    state.communityLoading = false;
    if (!error) state.communityPosts = data || [];
  }

  async function createPost(form) {
    if (!state.session || !navigator.onLine) throw new Error("Necesitas sesión y conexión para publicar.");
    const formData = new FormData(form);
    const body = String(formData.get("body") || "").trim();
    const activityId = String(formData.get("activity_id") || "") || null;
    const photos = formData.getAll("photos").filter((file) => file instanceof File && file.size > 0).slice(0, 4);
    if (activityId) {
      const { error: visibilityError } = await state.client.from("activities").update({ visibility: "public" }).eq("id", activityId).eq("user_id", state.session.user.id);
      if (visibilityError) throw visibilityError;
    }
    const { data: post, error } = await state.client.from("posts").insert({ user_id: state.session.user.id, activity_id: activityId, body }).select("id").single();
    if (error) throw error;

    for (const photo of photos) {
      const compressed = await compressImage(photo);
      const extension = compressed.type === "image/webp" ? "webp" : "jpg";
      const path = `${state.session.user.id}/${post.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await state.client.storage.from("community-media").upload(path, compressed, { contentType: compressed.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: mediaError } = await state.client.from("post_media").insert({ post_id: post.id, user_id: state.session.user.id, storage_path: path, mime_type: compressed.type });
      if (mediaError) throw mediaError;
    }
    form.reset();
    await loadCommunity();
    showAlert("Publicación compartida.", "ok");
    renderAll();
  }

  async function createComment(postId, body) {
    if (!state.session || !navigator.onLine) throw new Error("Necesitas sesión y conexión para comentar.");
    const { error } = await state.client.from("comments").insert({ post_id: postId, user_id: state.session.user.id, body: String(body).trim() });
    if (error) throw error;
    await loadCommunity();
    renderAll();
  }

  async function toggleLike(postId) {
    if (!state.session) return showAlert("Inicia sesión para dar me gusta.", "danger");
    const post = state.communityPosts.find((item) => item.id === postId);
    const liked = (post?.likes || []).some((like) => like.user_id === state.session.user.id);
    const query = liked
      ? state.client.from("likes").delete().eq("post_id", postId).eq("user_id", state.session.user.id)
      : state.client.from("likes").insert({ post_id: postId, user_id: state.session.user.id });
    const { error } = await query;
    if (error) return showAlert(normalizeError(error), "danger");
    await loadCommunity();
    renderAll();
  }

  async function compressImage(file) {
    const image = typeof createImageBitmap === "function" ? await createImageBitmap(file) : await loadImageElement(file);
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, width, height);
    image.close?.();
    const preferred = await canvasBlob(canvas, "image/webp", 0.82);
    return preferred || await canvasBlob(canvas, "image/jpeg", 0.84);
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la fotografía.")); };
      image.src = url;
    });
  }

  function mergeActivities() {
    const map = new Map();
    state.remoteActivities.forEach((item) => map.set(item.client_id, { ...item, sync_status: "synced" }));
    state.localActivities.forEach((item) => map.set(item.client_id, { ...(map.get(item.client_id) || {}), ...item }));
    return [...map.values()].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  function effectiveElapsed(record, now = Date.now()) {
    const currentPause = record.paused ? Math.max(0, now - record.paused_at_ms) : 0;
    return Math.max(0, (now - record.started_at_ms - record.paused_duration_ms - currentPause) / 1000);
  }

  function locationJson(point) {
    return { latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy };
  }

  function showAlert(message, level = "ok") {
    if (!state.ui) return;
    state.ui.alert.textContent = message;
    state.ui.alert.dataset.level = level;
    state.ui.alert.hidden = false;
  }

  function getView(name) {
    return state.ui.panel.querySelector(`[data-view="${name}"]`);
  }

  function prettyRoute(name) {
    return String(name || "Ruta").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function haversine(a, b) {
    const radius = 6371000;
    const lat1 = a.latitude * Math.PI / 180;
    const lat2 = b.latitude * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (b.longitude - a.longitude) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function formatDistance(meters) {
    return meters < 1000 ? `${Math.round(meters || 0)} m` : `${(meters / 1000).toFixed(2)} km`;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function formatPace(secondsPerKm) {
    if (!Number.isFinite(secondsPerKm)) return "—";
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")} min/km`;
  }

  function normalizeError(error) {
    const message = String(error?.message || "Ha ocurrido un error.");
    if (/invalid login/i.test(message)) return "Correo o contraseña incorrectos.";
    if (/already registered/i.test(message)) return "Este correo ya está registrado.";
    return message;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("activities")) {
          const store = db.createObjectStore("activities", { keyPath: "client_id" });
          store.createIndex("started_at", "started_at");
          store.createIndex("sync_status", "sync_status");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbRequest(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGet(store, key) { return dbRequest(store, "readonly", (objectStore) => objectStore.get(key)); }
  function dbGetAll(store) { return dbRequest(store, "readonly", (objectStore) => objectStore.getAll()); }
  function dbPut(store, value) { return dbRequest(store, "readwrite", (objectStore) => objectStore.put(value)); }
  function dbDelete(store, key) { return dbRequest(store, "readwrite", (objectStore) => objectStore.delete(key)); }
})();
