const viewer = new Cesium.Viewer("cesiumContainer", {
  baseLayerPicker: false,
  animation: false,
  timeline: false,
  geocoder: false,
  navigationHelpButton: false,
  homeButton: false,
  selectionIndicator: false,
  infoBox: false,
  shadows: true,
  imageryProvider: new Cesium.TileMapServiceImageryProvider({
    url: Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
  }),
});

viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.skyAtmosphere.brightnessShift = 0.15;

const appState = {
  mode: "view",
  selectedObject: null,
  objects: new Map(),
  axisMode: "none",
  axisSpace: "global",
  gizmo: null,
  numericBuffer: "",
  transformSession: null,
  menuPinned: false,
  menuSequence: [],
  viewSettings: {
    xray: false,
  },
  selectionFilter: "all",
  selectionMessageTimeout: null,
};

const stateEvents = new Map();

function emitStateEvent(name, detail) {
  const listeners = stateEvents.get(name);
  if (!listeners) return;
  [...listeners].forEach((callback) => {
    try {
      callback(detail);
    } catch (error) {
      console.error("State listener error", error);
    }
  });
}

function onStateChange(name, callback) {
  if (!stateEvents.has(name)) {
    stateEvents.set(name, new Set());
  }
  stateEvents.get(name).add(callback);
}

function offStateChange(name, callback) {
  const listeners = stateEvents.get(name);
  if (!listeners) return;
  listeners.delete(callback);
  if (listeners.size === 0) {
    stateEvents.delete(name);
  }
}

const menuBar = document.querySelector(".menu-bar");
const addMenu = document.querySelector(".menu-item[data-menu='add']");
const createCubeButton = document.querySelector(".action-button[data-action='create-cube']");
const parameterPanel = document.getElementById("parameter-panel");
const parameterForm = document.getElementById("parameter-form");
const parameterClose = document.getElementById("parameter-close");
const numericOverlay = document.getElementById("numeric-overlay");
const modeIndicator = document.getElementById("mode-indicator");
const axisIndicator = document.getElementById("axis-indicator");
const transformPanel = document.getElementById("transform-panel");
const transformForm = document.getElementById("transform-form");
const sceneToolbarMessage = document.getElementById("selection-filter-message");
const propertyPanel = document.getElementById("property-panel");
const propertyEmpty = document.getElementById("property-empty");
const propertyContent = document.getElementById("property-content");
const propertyName = document.getElementById("property-name");
const propertyType = document.getElementById("property-type");
const propertyId = document.getElementById("property-id");
const propertyVolume = document.getElementById("property-volume");
const propertyArea = document.getElementById("property-area");
const propertyForm = document.getElementById("property-form");
const materialColorInput = document.getElementById("material-color");
const materialOpacityInput = document.getElementById("material-opacity");
const materialOpacityValue = document.getElementById("material-opacity-value");
const outlineColorInput = document.getElementById("outline-color");
const outlineEnabledInput = document.getElementById("outline-enabled");
const fillEnabledInput = document.getElementById("fill-enabled");
const customLabelInput = document.getElementById("custom-label");
const xrayToggle = document.getElementById("xray-toggle");
const selectionFilter = document.getElementById("selection-filter");

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let gizmoEntities = [];

const GRID_STEP = 1.0;
const SHIFT_SLOW_RATIO = 0.2;

let objectCounter = 0;

const defaultCubeConfig = {
  dimensions: new Cesium.Cartesian3(20.0, 20.0, 20.0),
  color: Cesium.Color.fromCssColorString("#4f46e5").withAlpha(0.8),
  outlineColor: Cesium.Color.fromCssColorString("#ffb454"),
};

if (xrayToggle) {
  xrayToggle.checked = appState.viewSettings.xray;
}
if (selectionFilter) {
  selectionFilter.value = appState.selectionFilter;
}
updateSelectionFilterMessage();

function updateModeIndicator() {
  const labels = {
    view: "视图",
    translate: "移动",
    rotate: "旋转",
    scale: "缩放",
    create: "创建",
  };
  const label = labels[appState.mode] || appState.mode;
  modeIndicator.textContent = `模式：${label}`;
}

function updateAxisIndicator() {
  if (appState.axisMode === "none") {
    axisIndicator.textContent = "轴向：自由";
  } else {
    const space = appState.axisSpace === "local" ? "本地" : "全局";
    axisIndicator.textContent = `轴向：${appState.axisMode.toUpperCase()} (${space})`;
  }
  emitStateEvent("axis", { axis: appState.axisMode, space: appState.axisSpace });
}

function resetNumericBuffer() {
  appState.numericBuffer = "";
  numericOverlay.classList.add("hidden");
}

function showNumericBuffer() {
  if (!appState.numericBuffer) {
    numericOverlay.classList.add("hidden");
    return;
  }
  numericOverlay.textContent = appState.numericBuffer;
  numericOverlay.classList.remove("hidden");
}

function getSurfaceNormal(position) {
  const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(normal, normal);
}

function getEastNorthUpMatrix(position) {
  return Cesium.Transforms.eastNorthUpToFixedFrame(position);
}

function getAxisVector(axis, space, entity) {
  const unit = new Cesium.Cartesian3();
  switch (axis) {
    case "x":
      Cesium.Cartesian3.fromElements(1, 0, 0, unit);
      break;
    case "y":
      Cesium.Cartesian3.fromElements(0, 1, 0, unit);
      break;
    default:
      Cesium.Cartesian3.fromElements(0, 0, 1, unit);
      break;
  }

  if (!entity) {
    return unit;
  }

  if (space === "local" && Cesium.defined(entity.orientation)) {
    const orientationMatrix = Cesium.Matrix3.fromQuaternion(entity.orientation);
    return Cesium.Matrix3.multiplyByVector(orientationMatrix, unit, new Cesium.Cartesian3());
  }

  const enu = getEastNorthUpMatrix(entity.position.getValue(Cesium.JulianDate.now()));
  const vector = Cesium.Matrix4.getColumn(enu, axis === "x" ? 0 : axis === "y" ? 1 : 2, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(vector, vector);
}

function colorToHex(color) {
  if (!color) return "#ffffff";
  const r = Cesium.Math.clamp(Math.round(color.red * 255), 0, 255);
  const g = Cesium.Math.clamp(Math.round(color.green * 255), 0, 255);
  const b = Cesium.Math.clamp(Math.round(color.blue * 255), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function formatNumber(value, fractionDigits = 2) {
  return Number.parseFloat(value).toFixed(fractionDigits);
}

function computeBoxVolume(dimensions) {
  return dimensions.x * dimensions.y * dimensions.z;
}

function computeBoxArea(dimensions) {
  const xy = dimensions.x * dimensions.y;
  const yz = dimensions.y * dimensions.z;
  const xz = dimensions.x * dimensions.z;
  return 2 * (xy + yz + xz);
}

function updateSelectionFilterMessage() {
  if (!sceneToolbarMessage) return;
  if (appState.selectionMessageTimeout) {
    window.clearTimeout(appState.selectionMessageTimeout);
    appState.selectionMessageTimeout = null;
  }
  if (appState.selectionFilter === "all") {
    sceneToolbarMessage.classList.add("hidden");
  } else if (appState.selectionFilter === "mesh") {
    sceneToolbarMessage.textContent = "仅允许选择网格对象";
    sceneToolbarMessage.classList.remove("hidden");
  } else {
    sceneToolbarMessage.textContent = "当前过滤器不允许选择此类型";
    sceneToolbarMessage.classList.remove("hidden");
  }
}

function showSelectionFilteredHint() {
  if (!sceneToolbarMessage || appState.selectionFilter === "all") return;
  if (appState.selectionMessageTimeout) {
    window.clearTimeout(appState.selectionMessageTimeout);
  }
  const text = appState.selectionFilter === "mesh" ? "过滤器：仅网格可选" : "过滤器阻止选择当前对象";
  sceneToolbarMessage.textContent = text;
  sceneToolbarMessage.classList.remove("hidden");
  appState.selectionMessageTimeout = window.setTimeout(() => {
    updateSelectionFilterMessage();
  }, 2000);
}

function applyMaterial(entity, options = {}) {
  if (!entity || !entity.cubeMetadata) return;
  if (appState.transformSession && appState.transformSession.entity === entity && options.force !== true) {
    return;
  }

  const metadata = entity.cubeMetadata;
  const baseColor = metadata.color || defaultCubeConfig.color;
  const outlineColor = metadata.outlineColor || defaultCubeConfig.outlineColor;
  const fillEnabled = metadata.fillEnabled !== false;
  const outlineEnabled = metadata.outlineEnabled !== false;
  const baseOpacity = Cesium.Math.clamp(metadata.opacity ?? baseColor.alpha ?? 0.8, 0.05, 1.0);

  let finalAlpha = baseOpacity;
  if (appState.viewSettings.xray) {
    finalAlpha = Math.min(finalAlpha, 0.35);
  }
  if (options.selected) {
    const highlightFloor = appState.viewSettings.xray ? 0.55 : 0.7;
    finalAlpha = Math.max(finalAlpha, highlightFloor);
    finalAlpha = Math.min(finalAlpha, 1.0);
  }

  entity.box.fill = fillEnabled;
  entity.box.material = new Cesium.ColorMaterialProperty(baseColor.withAlpha(finalAlpha));
  entity.box.outline = outlineEnabled || options.selected;
  const displayOutlineColor = options.selected ? Cesium.Color.ORANGE : outlineColor;
  entity.box.outlineColor = displayOutlineColor.withAlpha(appState.viewSettings.xray ? 0.6 : 1.0);
}

function refreshAllMaterials() {
  appState.objects.forEach((entity) => {
    const isSelected = entity === appState.selectedObject && !appState.transformSession;
    applyMaterial(entity, { selected: isSelected, force: true });
  });
}

function updatePropertyPanel(entity) {
  if (!propertyPanel) return;
  if (!entity) {
    propertyContent.classList.add("hidden");
    propertyEmpty.classList.remove("hidden");
    propertyName.textContent = "";
    propertyId.textContent = "";
    return;
  }

  propertyContent.classList.remove("hidden");
  propertyEmpty.classList.add("hidden");

  const metadata = entity.cubeMetadata || {};
  const julianNow = Cesium.JulianDate.now();
  const dims = entity.box.dimensions.getValue(julianNow);

  propertyName.textContent = metadata.label || entity.name || entity.id || "对象";
  const typeLabel = metadata.type ? metadata.type.charAt(0).toUpperCase() + metadata.type.slice(1) : "Object";
  propertyType.textContent = typeLabel;
  propertyId.textContent = `#${entity.id || "-"}`;
  propertyVolume.textContent = `${formatNumber(computeBoxVolume(dims))} m³`;
  propertyArea.textContent = `${formatNumber(computeBoxArea(dims))} m²`;

  const baseColor = metadata.color || defaultCubeConfig.color;
  materialColorInput.value = colorToHex(baseColor);
  const opacityValue = Cesium.Math.clamp(metadata.opacity ?? baseColor.alpha ?? 0.8, 0.05, 1.0);
  materialOpacityInput.value = opacityValue;
  materialOpacityValue.textContent = opacityValue.toFixed(2);
  outlineColorInput.value = colorToHex(metadata.outlineColor || defaultCubeConfig.outlineColor);
  outlineEnabledInput.checked = metadata.outlineEnabled !== false;
  fillEnabledInput.checked = metadata.fillEnabled !== false;
  customLabelInput.value = metadata.label || "";
}

function isSelectionAllowed(entity) {
  if (appState.selectionFilter === "all") return true;
  const type = entity?.cubeMetadata?.type || "object";
  return type === appState.selectionFilter;
}

function handlePropertyFormInput(event) {
  if (!appState.selectedObject) return;
  const entity = appState.selectedObject;
  const metadata = entity.cubeMetadata;
  if (!metadata) return;

  const target = event.target;
  switch (target.name) {
    case "materialColor":
      metadata.color = Cesium.Color.fromCssColorString(target.value).withAlpha(1.0);
      break;
    case "materialOpacity":
      metadata.opacity = Cesium.Math.clamp(parseFloat(target.value), 0.05, 1.0);
      materialOpacityValue.textContent = metadata.opacity.toFixed(2);
      break;
    case "outlineColor":
      metadata.outlineColor = Cesium.Color.fromCssColorString(target.value).withAlpha(1.0);
      break;
    case "outlineEnabled":
      metadata.outlineEnabled = target.checked;
      break;
    case "fillEnabled":
      metadata.fillEnabled = target.checked;
      break;
    case "customLabel":
      metadata.label = target.value.trim();
      entity.name = metadata.label || entity.id;
      propertyName.textContent = metadata.label || entity.name || entity.id;
      break;
    default:
      return;
  }

  applyMaterial(entity, { selected: true, force: true });
}

function createCube(position, options = {}) {
  const id = ++objectCounter;
  const name = `Cube_${id}`;
  const dimensions = options.dimensions || defaultCubeConfig.dimensions;
  const color = options.color || defaultCubeConfig.color;
  const outlineColor = options.outlineColor || defaultCubeConfig.outlineColor;

  const cubeEntity = viewer.entities.add({
    id: name,
    name,
    position,
    orientation: Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll()),
    box: {
      dimensions: Cesium.Cartesian3.clone(dimensions),
      material: color,
      outline: true,
      outlineColor,
    },
  });

  cubeEntity.cubeMetadata = {
    dimensions: Cesium.Cartesian3.clone(dimensions),
    color,
    outlineColor,
    opacity: options.opacity ?? color.alpha ?? 0.8,
    outlineEnabled: true,
    fillEnabled: true,
    type: "mesh",
    label: options.label || "",
  };

  appState.objects.set(name, cubeEntity);
  applyMaterial(cubeEntity, { selected: true, force: true });
  focusOnEntity(cubeEntity);
  setSelectedObject(cubeEntity);
  openParameterPanel();
  return cubeEntity;
}

function removeObjectById(id) {
  if (!appState.objects.has(id)) return false;
  const entity = appState.objects.get(id);
  if (appState.selectedObject === entity) {
    setSelectedObject(null);
  }
  const removed = viewer.entities.remove(entity);
  appState.objects.delete(id);
  return removed;
}

function getSpawnPosition() {
  const canvas = viewer.scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let pick;
  if (viewer.scene.pickPositionSupported) {
    pick = viewer.scene.pickPosition(center);
  }
  if (!Cesium.defined(pick)) {
    const ray = viewer.camera.getPickRay(center);
    if (Cesium.defined(ray)) {
      pick = viewer.scene.globe.pick(ray, viewer.scene);
    }
  }
  if (Cesium.defined(pick)) {
    return pick;
  }
  const cameraPosition = viewer.camera.positionWC;
  const normal = getSurfaceNormal(cameraPosition);
  return Cesium.Cartesian3.add(
    cameraPosition,
    Cesium.Cartesian3.multiplyByScalar(normal, -30.0, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
}

function focusOnEntity(entity) {
  viewer.flyTo(entity, {
    offset: new Cesium.HeadingPitchRange(0, -0.5, 80),
    duration: 0.8,
  });
}

function setSelectedObject(entity) {
  if (appState.selectedObject === entity) {
    updatePanels(entity);
    return;
  }

  if (Cesium.defined(appState.selectedObject)) {
    restoreDefaultMaterial(appState.selectedObject);
  }

  appState.selectedObject = entity;

  if (Cesium.defined(entity)) {
    highlightEntity(entity);
    updatePanels(entity);
    ensureGizmo(entity);
    refreshGizmoHighlight();
    parameterPanel.classList.remove("hidden");
    emitStateEvent("selection", { entity, selected: true });
  } else {
    hidePanels();
    removeGizmo();
    updatePropertyPanel(null);
    emitStateEvent("selection", { entity: null, selected: false });
  }
}

function highlightEntity(entity) {
  applyMaterial(entity, { selected: true, force: true });
}

function restoreDefaultMaterial(entity) {
  applyMaterial(entity, { selected: false, force: true });
}

function openParameterPanel() {
  parameterPanel.classList.remove("hidden");
}

function hidePanels() {
  parameterPanel.classList.add("hidden");
  transformPanel.classList.add("hidden");
}

function updatePanels(entity) {
  if (!entity) {
    hidePanels();
    return;
  }

  const julianNow = Cesium.JulianDate.now();
  const position = Cesium.Cartesian3.clone(entity.position.getValue(julianNow));
  const dimensions = entity.box.dimensions.getValue(julianNow);
  const orientation = Cesium.Quaternion.clone(entity.orientation.getValue(julianNow));
  const hpr = Cesium.HeadingPitchRoll.fromQuaternion(orientation);

  parameterForm.width.value = dimensions.x.toFixed(2);
  parameterForm.height.value = dimensions.y.toFixed(2);
  parameterForm.depth.value = dimensions.z.toFixed(2);
  parameterForm.posX.value = position.x.toFixed(2);
  parameterForm.posY.value = position.y.toFixed(2);
  parameterForm.posZ.value = position.z.toFixed(2);

  transformForm.transformPosX.value = position.x.toFixed(2);
  transformForm.transformPosY.value = position.y.toFixed(2);
  transformForm.transformPosZ.value = position.z.toFixed(2);
  transformForm.transformHeading.value = Cesium.Math.toDegrees(hpr.heading).toFixed(1);
  transformForm.transformPitch.value = Cesium.Math.toDegrees(hpr.pitch).toFixed(1);
  transformForm.transformRoll.value = Cesium.Math.toDegrees(hpr.roll).toFixed(1);

  transformForm.transformScaleX.value = (dimensions.x / defaultCubeConfig.dimensions.x).toFixed(2);
  transformForm.transformScaleY.value = (dimensions.y / defaultCubeConfig.dimensions.y).toFixed(2);
  transformForm.transformScaleZ.value = (dimensions.z / defaultCubeConfig.dimensions.z).toFixed(2);
  updatePropertyPanel(entity);
}

function removeGizmo() {
  gizmoEntities.forEach((e) => viewer.entities.remove(e));
  gizmoEntities = [];
  appState.gizmo = null;
}

function computeAxisEndpoints(entity, axis, length = 20.0) {
  const julianNow = Cesium.JulianDate.now();
  const position = entity.position.getValue(julianNow);
  const baseMatrix = getEastNorthUpMatrix(position);
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const axisVector = Cesium.Matrix4.getColumn(baseMatrix, index, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(axisVector, axisVector);
  const endPoint = Cesium.Cartesian3.add(
    position,
    Cesium.Cartesian3.multiplyByScalar(axisVector, length, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  return { start: position, end: endPoint };
}

function ensureGizmo(entity) {
  if (!entity) {
    removeGizmo();
    return;
  }

  if (appState.gizmo && appState.gizmo.entity === entity) {
    return;
  }

  removeGizmo();

  const axisColors = {
    x: Cesium.Color.RED,
    y: Cesium.Color.LIME,
    z: Cesium.Color.SKYBLUE,
  };

  const axes = {};

  ["x", "y", "z"].forEach((axis) => {
    const color = axisColors[axis];
    const polyline = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const points = computeAxisEndpoints(entity, axis);
          return [points.start, points.end];
        }, false),
        material: color.withAlpha(0.7),
        width: 3,
      },
    });

    const label = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const points = computeAxisEndpoints(entity, axis);
        return points.end;
      }, false),
      label: {
        text: axis.toUpperCase(),
        font: "16px Inter",
        fillColor: color,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.45),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 1000000.0),
        pixelOffset: new Cesium.Cartesian2(0, -15),
      },
    });

    gizmoEntities.push(polyline, label);
    axes[axis] = { polyline, label, color };
  });

  appState.gizmo = { entity, axes };
  refreshGizmoHighlight();
}

function updateGizmoPosition() {
  if (!appState.gizmo || !appState.selectedObject) return;
  ensureGizmo(appState.selectedObject);
}

function refreshGizmoHighlight() {
  if (!appState.gizmo) return;
  Object.entries(appState.gizmo.axes).forEach(([axis, data]) => {
    const active = appState.axisMode === axis;
    data.polyline.polyline.width = active ? 6 : 3;
    data.polyline.polyline.material = active
      ? data.color.withAlpha(1.0)
      : data.color.withAlpha(0.7);
  });
}

function updateRotationBasis(session) {
  if (!session) return;
  const { entity } = session;
  const julianNow = Cesium.JulianDate.now();
  const position = entity.position.getValue(julianNow);
  const axisKey = session.activeAxis && session.activeAxis !== "none" ? session.activeAxis : "z";
  const axisVector = Cesium.Cartesian3.normalize(
    getAxisVector(axisKey, session.axisSpace, entity),
    new Cesium.Cartesian3()
  );
  let reference = Cesium.Cartesian3.UNIT_Z;
  if (Math.abs(Cesium.Cartesian3.dot(axisVector, reference)) > 0.9) {
    reference = Cesium.Cartesian3.UNIT_X;
  }
  let perp1 = Cesium.Cartesian3.cross(axisVector, reference, new Cesium.Cartesian3());
  if (Cesium.Cartesian3.magnitude(perp1) < Cesium.Math.EPSILON7) {
    perp1 = Cesium.Cartesian3.cross(axisVector, Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3());
  }
  Cesium.Cartesian3.normalize(perp1, perp1);
  const perp2 = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(axisVector, perp1, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  session.rotationBasis = {
    axisKey,
    axisVector,
    perp1,
    perp2,
    position,
  };
}

function computeRotationArcPositions(session) {
  if (!session || !session.rotationBasis) return [];
  const { position, perp1, perp2 } = session.rotationBasis;
  const angle = session.rotationAngle || 0;
  const radius = 25.0;
  if (Math.abs(angle) < Cesium.Math.EPSILON6) {
    const start = Cesium.Cartesian3.add(
      position,
      Cesium.Cartesian3.multiplyByScalar(perp1, radius, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    return [start, start];
  }
  const steps = Math.max(2, Math.ceil(Math.abs(Cesium.Math.toDegrees(angle)) / 5) + 1);
  const increment = angle / (steps - 1);
  const points = [];
  for (let i = 0; i < steps; i += 1) {
    const current = increment * i;
    const direction = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(perp1, Math.cos(current), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(perp2, Math.sin(current), new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const scaled = Cesium.Cartesian3.multiplyByScalar(direction, radius, new Cesium.Cartesian3());
    points.push(Cesium.Cartesian3.add(position, scaled, new Cesium.Cartesian3()));
  }
  return points;
}

function computeRotationLabelPosition(session) {
  if (!session || !session.rotationBasis) return new Cesium.Cartesian3();
  const { position, perp1, perp2 } = session.rotationBasis;
  const angle = session.rotationAngle || 0;
  const radius = 30.0;
  const direction = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(perp1, Math.cos(angle), new Cesium.Cartesian3()),
    Cesium.Cartesian3.multiplyByScalar(perp2, Math.sin(angle), new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  const scaled = Cesium.Cartesian3.multiplyByScalar(direction, radius, new Cesium.Cartesian3());
  return Cesium.Cartesian3.add(position, scaled, new Cesium.Cartesian3());
}

function setupRotationFeedback(session) {
  updateRotationBasis(session);
  session.rotationAngle = 0;
  if (session.rotationArcEntity) {
    viewer.entities.remove(session.rotationArcEntity);
  }
  if (session.rotationLabelEntity) {
    viewer.entities.remove(session.rotationLabelEntity);
  }
  session.rotationArcEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => computeRotationArcPositions(session), false),
      material: Cesium.Color.ORANGE.withAlpha(0.75),
      width: 3,
      arcType: Cesium.ArcType.NONE,
    },
  });
  session.rotationLabelEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty(() => computeRotationLabelPosition(session), false),
    label: {
      text: new Cesium.CallbackProperty(
        () => `${Cesium.Math.toDegrees(session.rotationAngle || 0).toFixed(1)}°`,
        false
      ),
      font: "16px Inter",
      fillColor: Cesium.Color.ORANGE,
      showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.45),
      pixelOffset: new Cesium.Cartesian2(0, -20),
      translucencyByDistance: new Cesium.NearFarScalar(100.0, 1.0, 1000000.0, 1.0),
    },
  });
}

function clearRotationFeedback(session) {
  if (!session) return;
  if (session.rotationArcEntity) {
    viewer.entities.remove(session.rotationArcEntity);
    session.rotationArcEntity = null;
  }
  if (session.rotationLabelEntity) {
    viewer.entities.remove(session.rotationLabelEntity);
    session.rotationLabelEntity = null;
  }
  session.rotationBasis = null;
}

createCubeButton.addEventListener("click", () => {
  createCube(getSpawnPosition());
  appState.menuPinned = false;
  hideAddMenu();
});

parameterClose.addEventListener("click", () => {
  parameterPanel.classList.add("hidden");
});

parameterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appState.selectedObject) return;
  const width = parseFloat(parameterForm.width.value);
  const height = parseFloat(parameterForm.height.value);
  const depth = parseFloat(parameterForm.depth.value);
  const posX = parseFloat(parameterForm.posX.value);
  const posY = parseFloat(parameterForm.posY.value);
  const posZ = parseFloat(parameterForm.posZ.value);

  const entity = appState.selectedObject;
  entity.box.dimensions = new Cesium.Cartesian3(width, height, depth);
  entity.position = new Cesium.ConstantPositionProperty(new Cesium.Cartesian3(posX, posY, posZ));
  entity.cubeMetadata.dimensions = new Cesium.Cartesian3(width, height, depth);
  updatePanels(entity);
  updateGizmoPosition();
});

if (propertyForm) {
  propertyForm.addEventListener("input", handlePropertyFormInput);
}

if (xrayToggle) {
  xrayToggle.addEventListener("change", (event) => {
    appState.viewSettings.xray = event.target.checked;
    refreshAllMaterials();
  });
}

if (selectionFilter) {
  selectionFilter.addEventListener("change", (event) => {
    appState.selectionFilter = event.target.value;
    updateSelectionFilterMessage();
    if (appState.selectedObject && !isSelectionAllowed(appState.selectedObject)) {
      setSelectedObject(null);
    }
  });
}

transformForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appState.selectedObject) return;
  const entity = appState.selectedObject;

  const posX = parseFloat(transformForm.transformPosX.value);
  const posY = parseFloat(transformForm.transformPosY.value);
  const posZ = parseFloat(transformForm.transformPosZ.value);
  const heading = Cesium.Math.toRadians(parseFloat(transformForm.transformHeading.value));
  const pitch = Cesium.Math.toRadians(parseFloat(transformForm.transformPitch.value));
  const roll = Cesium.Math.toRadians(parseFloat(transformForm.transformRoll.value));
  const scaleX = parseFloat(transformForm.transformScaleX.value);
  const scaleY = parseFloat(transformForm.transformScaleY.value);
  const scaleZ = parseFloat(transformForm.transformScaleZ.value);

  entity.position = new Cesium.ConstantPositionProperty(new Cesium.Cartesian3(posX, posY, posZ));
  entity.orientation = new Cesium.ConstantProperty(
    Cesium.Transforms.headingPitchRollQuaternion(
      new Cesium.Cartesian3(posX, posY, posZ),
      new Cesium.HeadingPitchRoll(heading, pitch, roll)
    )
  );
  const updatedDimensions = new Cesium.Cartesian3(
    defaultCubeConfig.dimensions.x * scaleX,
    defaultCubeConfig.dimensions.y * scaleY,
    defaultCubeConfig.dimensions.z * scaleZ
  );
  entity.box.dimensions = updatedDimensions;
  entity.cubeMetadata.dimensions = Cesium.Cartesian3.clone(updatedDimensions, new Cesium.Cartesian3());
  updatePanels(entity);
  updateGizmoPosition();
});

function hideAddMenu() {
  addMenu.classList.remove("active");
  appState.menuSequence = [];
}

function showAddMenu() {
  addMenu.classList.add("active");
}

menuBar.addEventListener("mouseleave", () => {
  if (!appState.menuPinned) hideAddMenu();
});

function handleSelection(click) {
  if (appState.mode !== "view" && appState.mode !== "create") return;

  const picked = viewer.scene.pick(click.position);
  if (Cesium.defined(picked) && picked.id && picked.id.box) {
    if (isSelectionAllowed(picked.id)) {
      setSelectedObject(picked.id);
    } else {
      showSelectionFilteredHint();
    }
  } else {
    setSelectedObject(null);
  }
}

handler.setInputAction((movement) => {
  if (appState.mode === "translate") {
    performTranslate(movement.endPosition);
  } else if (appState.mode === "rotate") {
    performRotate(movement.endPosition, movement.startPosition);
  } else if (appState.mode === "scale") {
    performScale(movement.endPosition, movement.startPosition);
  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

handler.setInputAction((click) => {
  if (appState.mode === "translate" || appState.mode === "rotate" || appState.mode === "scale") {
    commitTransform();
    return;
  }
  handleSelection(click);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

handler.setInputAction((click) => {
  if (appState.mode === "translate" || appState.mode === "rotate" || appState.mode === "scale") {
    cancelTransform();
    return;
  }
  if (appState.selectedObject) {
    setSelectedObject(null);
  }
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

function beginTransform(mode) {
  if (!appState.selectedObject) return;
  const entity = appState.selectedObject;
  const julianNow = Cesium.JulianDate.now();
  const initialDimensions = Cesium.Cartesian3.clone(
    entity.box.dimensions.getValue(julianNow),
    new Cesium.Cartesian3()
  );

  appState.transformSession = {
    mode,
    entity,
    initialPosition: Cesium.Cartesian3.clone(entity.position.getValue(julianNow)),
    initialOrientation: Cesium.Quaternion.clone(entity.orientation.getValue(julianNow)),
    initialDimensions,
    activeAxis: appState.axisMode,
    axisSpace: appState.axisSpace,
    isShift: false,
    isCtrl: false,
    lastDirection: null,
    numericApplied: false,
    lockProportion: false,
  };

  const baseColor = entity.box.material.getValue(julianNow);
  entity.box.material = new Cesium.ColorMaterialProperty(baseColor.withAlpha(0.4));
  setMode(mode);
  resetNumericBuffer();
  refreshGizmoHighlight();
  if (mode === "rotate") {
    setupRotationFeedback(appState.transformSession);
  }
  emitStateEvent("transform", { phase: "start", mode });
}

function commitTransform() {
  if (!appState.transformSession) return;
  const { entity } = appState.transformSession;
  clearRotationFeedback(appState.transformSession);
  restoreDefaultMaterial(entity);
  appState.transformSession = null;
  setMode("view");
  resetNumericBuffer();
  appState.axisMode = "none";
  appState.axisSpace = "global";
  updateAxisIndicator();
  refreshGizmoHighlight();
  updatePanels(entity);
  updateGizmoPosition();
  emitStateEvent("transform", { phase: "commit", entity });
}

function cancelTransform() {
  if (!appState.transformSession) return;
  const { entity, initialPosition, initialOrientation, initialDimensions } = appState.transformSession;
  entity.position = new Cesium.ConstantPositionProperty(initialPosition);
  entity.orientation = new Cesium.ConstantProperty(initialOrientation);
  entity.box.dimensions = new Cesium.Cartesian3(initialDimensions.x, initialDimensions.y, initialDimensions.z);
  clearRotationFeedback(appState.transformSession);
  restoreDefaultMaterial(entity);
  appState.transformSession = null;
  setMode("view");
  resetNumericBuffer();
  appState.axisMode = "none";
  appState.axisSpace = "global";
  updateAxisIndicator();
  refreshGizmoHighlight();
  updatePanels(entity);
  updateGizmoPosition();
  emitStateEvent("transform", { phase: "cancel", entity });
}

function setMode(mode) {
  appState.mode = mode;
  updateModeIndicator();
  emitStateEvent("mode", { mode });
  if (mode === "view") {
    return;
  }
  transformPanel.classList.remove("hidden");
}

function computeDragPlane(entity, axis) {
  const position = entity.position.getValue(Cesium.JulianDate.now());
  if (!axis || axis === "none") {
    const normal = getSurfaceNormal(position);
    return Cesium.Plane.fromPointNormal(position, normal);
  }
  const axisVector = getAxisVector(axis, appState.axisSpace, entity);
  const cameraDir = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.negate(viewer.camera.direction, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  const planeNormal = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(axisVector, cameraDir, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  if (Cesium.Cartesian3.magnitude(planeNormal) < Cesium.Math.EPSILON7) {
    const fallback = getSurfaceNormal(position);
    return Cesium.Plane.fromPointNormal(position, fallback);
  }
  return Cesium.Plane.fromPointNormal(position, planeNormal);
}

function performTranslate(endPosition) {
  const session = appState.transformSession;
  if (!session) return;
  const entity = session.entity;
  const plane = computeDragPlane(entity, session.activeAxis);
  const ray = viewer.camera.getPickRay(endPosition);
  if (!Cesium.defined(ray)) return;
  const t = Cesium.IntersectionTests.rayPlane(ray, plane);
  if (!Cesium.defined(t)) return;
  const intersection = Cesium.Ray.getPoint(ray, t, new Cesium.Cartesian3());
  const delta = Cesium.Cartesian3.subtract(intersection, session.initialPosition, new Cesium.Cartesian3());

  let direction = delta;
  if (session.activeAxis && session.activeAxis !== "none") {
    const axisVector = getAxisVector(session.activeAxis, session.axisSpace, entity);
    const projected = Cesium.Cartesian3.multiplyByScalar(
      axisVector,
      Cesium.Cartesian3.dot(delta, axisVector),
      new Cesium.Cartesian3()
    );
    direction = projected;
  }

  if (session.isShift) {
    direction = Cesium.Cartesian3.multiplyByScalar(direction, SHIFT_SLOW_RATIO, new Cesium.Cartesian3());
  }

  if (session.isCtrl) {
    direction = snapVector(direction, GRID_STEP);
  }

  session.lastDirection = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  const newPosition = Cesium.Cartesian3.add(session.initialPosition, direction, new Cesium.Cartesian3());
  entity.position = new Cesium.ConstantPositionProperty(newPosition);
  updatePanels(entity);
  updateGizmoPosition();
}

function performRotate(endPosition, startPosition) {
  const session = appState.transformSession;
  if (!session) return;
  const entity = session.entity;
  const axisKey = session.activeAxis && session.activeAxis !== "none" ? session.activeAxis : "z";
  const axisVector = getAxisVector(axisKey, session.axisSpace, entity);
  const delta = computeCursorDelta(startPosition, endPosition);
  const angle = Cesium.Math.toRadians(delta.x * 0.25);
  let finalAngle = angle;
  if (session.isCtrl) {
    const snapped = Cesium.Math.toRadians(5.0);
    finalAngle = Math.round(finalAngle / snapped) * snapped;
    finalAngle = snapAngleToCommon(finalAngle);
  }
  session.lastDirection = axisVector;
  session.rotationAngle = finalAngle;

  const rotationQuat = Cesium.Quaternion.fromAxisAngle(axisVector, finalAngle);
  const combined = Cesium.Quaternion.multiply(rotationQuat, session.initialOrientation, new Cesium.Quaternion());
  entity.orientation = new Cesium.ConstantProperty(combined);
  updatePanels(entity);
  updateGizmoPosition();
}

function snapAngleToCommon(angle) {
  const degrees = Cesium.Math.toDegrees(angle);
  const snapTargets = [15, 30, 45, 90];
  let snappedDeg = degrees;
  snapTargets.forEach((target) => {
    if (Math.abs(degrees - target) < 3) snappedDeg = target;
    if (Math.abs(degrees + target) < 3) snappedDeg = -target;
  });
  return Cesium.Math.toRadians(snappedDeg);
}

function computeCursorDelta(start, end) {
  if (!start || !end) {
    return { x: 0, y: 0 };
  }
  return {
    x: end.x - start.x,
    y: end.y - start.y,
  };
}

function performScale(endPosition, startPosition) {
  const session = appState.transformSession;
  if (!session) return;
  const entity = session.entity;
  const delta = computeCursorDelta(startPosition, endPosition);
  let scaleFactor = 1 + delta.y * -0.005;
  if (session.isShift) {
    scaleFactor = 1 + (delta.y * -0.0025);
  }
  if (scaleFactor <= 0.05) scaleFactor = 0.05;

  const dims = session.initialDimensions;

  let newDimensions;
  if (!session.activeAxis || session.activeAxis === "none") {
    newDimensions = new Cesium.Cartesian3(dims.x * scaleFactor, dims.y * scaleFactor, dims.z * scaleFactor);
  } else {
    newDimensions = new Cesium.Cartesian3(dims.x, dims.y, dims.z);
    if (session.activeAxis === "x") newDimensions.x = dims.x * scaleFactor;
    if (session.activeAxis === "y") newDimensions.y = dims.y * scaleFactor;
    if (session.activeAxis === "z") newDimensions.z = dims.z * scaleFactor;
    if (session.lockProportion) {
      const axisValue =
        session.activeAxis === "x"
          ? newDimensions.x / dims.x
          : session.activeAxis === "y"
          ? newDimensions.y / dims.y
          : newDimensions.z / dims.z;
      newDimensions = new Cesium.Cartesian3(
        dims.x * axisValue,
        dims.y * axisValue,
        dims.z * axisValue
      );
    }
  }

  if (session.isCtrl) {
    newDimensions = new Cesium.Cartesian3(
      snapValue(newDimensions.x, GRID_STEP),
      snapValue(newDimensions.y, GRID_STEP),
      snapValue(newDimensions.z, GRID_STEP)
    );
  }

  entity.box.dimensions = newDimensions;
  entity.cubeMetadata.dimensions = newDimensions;
  updatePanels(entity);
  updateGizmoPosition();
}

function snapVector(vector, step) {
  return new Cesium.Cartesian3(
    snapValue(vector.x, step),
    snapValue(vector.y, step),
    snapValue(vector.z, step)
  );
}

function snapValue(value, step) {
  return Math.round(value / step) * step;
}

function applyNumericInput() {
  if (!appState.transformSession) return;
  const value = parseFloat(appState.numericBuffer);
  if (Number.isNaN(value)) {
    resetNumericBuffer();
    return;
  }
  const session = appState.transformSession;
  const entity = session.entity;
  if (session.mode === "translate") {
    let axisVector;
    if (session.activeAxis && session.activeAxis !== "none") {
      axisVector = getAxisVector(session.activeAxis, session.axisSpace, entity);
    } else if (session.lastDirection) {
      axisVector = session.lastDirection;
    } else {
      axisVector = getAxisVector("x", session.axisSpace, entity);
    }
    const offset = Cesium.Cartesian3.multiplyByScalar(axisVector, value, new Cesium.Cartesian3());
    const newPosition = Cesium.Cartesian3.add(session.initialPosition, offset, new Cesium.Cartesian3());
    entity.position = new Cesium.ConstantPositionProperty(newPosition);
  } else if (session.mode === "rotate") {
    let axisVector = session.lastDirection || getAxisVector("z", session.axisSpace, entity);
    const angle = Cesium.Math.toRadians(value);
    const rotationQuat = Cesium.Quaternion.fromAxisAngle(axisVector, angle);
    const combined = Cesium.Quaternion.multiply(rotationQuat, session.initialOrientation, new Cesium.Quaternion());
    entity.orientation = new Cesium.ConstantProperty(combined);
    session.rotationAngle = angle;
  } else if (session.mode === "scale") {
    let newDimensions;
    const dims = session.initialDimensions;
    if (!session.activeAxis || session.activeAxis === "none") {
      const factor = value;
      newDimensions = new Cesium.Cartesian3(
        dims.x * factor,
        dims.y * factor,
        dims.z * factor
      );
    } else {
      newDimensions = new Cesium.Cartesian3(dims.x, dims.y, dims.z);
      if (session.activeAxis === "x") newDimensions.x = dims.x * value;
      if (session.activeAxis === "y") newDimensions.y = dims.y * value;
      if (session.activeAxis === "z") newDimensions.z = dims.z * value;
      if (session.lockProportion) {
        const ratio =
          session.activeAxis === "x"
            ? newDimensions.x / dims.x
            : session.activeAxis === "y"
            ? newDimensions.y / dims.y
            : newDimensions.z / dims.z;
        newDimensions = new Cesium.Cartesian3(dims.x * ratio, dims.y * ratio, dims.z * ratio);
      }
    }
    entity.box.dimensions = newDimensions;
    entity.cubeMetadata.dimensions = newDimensions;
  }
  updatePanels(entity);
  updateGizmoPosition();
  appState.transformSession.numericApplied = true;
  resetNumericBuffer();
}

function handleKeyDown(event) {
  if (event.repeat) return;
  const { key } = event;

  if (event.shiftKey && key.toLowerCase() === "a") {
    event.preventDefault();
    showAddMenu();
    appState.menuPinned = true;
    appState.menuSequence = [];
    return;
  }

  if (key === "Escape") {
    if (appState.transformSession) {
      cancelTransform();
      return;
    }
    resetNumericBuffer();
    setMode("view");
    appState.axisMode = "none";
    appState.axisSpace = "global";
    updateAxisIndicator();
    refreshGizmoHighlight();
    appState.menuPinned = false;
    hideAddMenu();
    return;
  }

  if (["g", "r", "s"].includes(key.toLowerCase())) {
    event.preventDefault();
    if (!appState.selectedObject) return;
    if (key.toLowerCase() === "g") beginTransform("translate");
    if (key.toLowerCase() === "r") beginTransform("rotate");
    if (key.toLowerCase() === "s") beginTransform("scale");
    return;
  }

  if (appState.menuPinned && !appState.transformSession) {
    const lower = key.toLowerCase();
    if (lower === "m") {
      appState.menuSequence = ["m"];
      return;
    }
    if (lower === "c" && (appState.menuSequence.length === 0 || appState.menuSequence[0] === "m")) {
      createCube(getSpawnPosition());
      appState.menuPinned = false;
      hideAddMenu();
      return;
    }
  }

  if (["x", "y", "z"].includes(key.toLowerCase())) {
    event.preventDefault();
    const axis = key.toLowerCase();
    if (appState.axisMode === axis) {
      appState.axisSpace = appState.axisSpace === "global" ? "local" : "global";
    } else {
      appState.axisSpace = "global";
    }
    appState.axisMode = axis;
    updateAxisIndicator();
    refreshGizmoHighlight();
    if (appState.transformSession) {
      appState.transformSession.activeAxis = axis;
      appState.transformSession.axisSpace = appState.axisSpace;
      if (appState.transformSession.mode === "rotate") {
        updateRotationBasis(appState.transformSession);
      }
    }
    return;
  }

  if (key === "N" || key === "n") {
    transformPanel.classList.toggle("hidden");
    return;
  }

  if (appState.transformSession) {
    if (key === "Shift") {
      appState.transformSession.isShift = true;
      return;
    }
    if (key === "Control") {
      appState.transformSession.isCtrl = true;
      return;
    }
    if (key === "Alt") {
      appState.transformSession.lockProportion = true;
      return;
    }
  }

  if (appState.transformSession && /^[0-9\.-]$/.test(key)) {
    appState.numericBuffer += key;
    showNumericBuffer();
    return;
  }

  if (appState.transformSession && key === "Enter" && appState.numericBuffer) {
    applyNumericInput();
    return;
  }
}

function handleKeyUp(event) {
  const { key } = event;
  if (appState.transformSession) {
    if (key === "Shift") {
      appState.transformSession.isShift = false;
    }
    if (key === "Control") {
      appState.transformSession.isCtrl = false;
    }
    if (key === "Alt") {
      appState.transformSession.lockProportion = false;
    }
  }
  if (event.key === "Shift" && appState.menuPinned) {
    appState.menuPinned = false;
    hideAddMenu();
  }
}

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);

document.addEventListener("click", (event) => {
  if (!menuBar.contains(event.target)) {
    hideAddMenu();
    appState.menuPinned = false;
  }
});

viewer.scene.postRender.addEventListener(() => {
  if (appState.selectedObject) {
    updateGizmoPosition();
  }
});

updateModeIndicator();
updateAxisIndicator();

export { onStateChange, offStateChange, removeObjectById };
