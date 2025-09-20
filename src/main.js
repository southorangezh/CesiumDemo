// 设置Cesium Ion访问令牌
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjMjdkYThkNC05NWZkLTQ4YmYtOGI2MC1kNGM5MTJmYzAwNmQiLCJpZCI6MjM0NjM5LCJpYXQiOjE3MjM2MDYxOTR9.0WrwApMfIqf1Rvr3g3M-uw-IaZjmt9cGtF016_bnMzo';

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

// 确保 Cesium 容器尺寸正确
function ensureCesiumContainerSize() {
  const container = document.getElementById("cesiumContainer");
  if (container) {
    const rect = container.getBoundingClientRect();
    if (rect.height > window.innerHeight || rect.width > window.innerWidth) {
      console.warn("Cesium 容器尺寸异常，正在重置...");
      container.style.height = "100%";
      container.style.width = "100%";
      container.style.maxHeight = "100vh";
      container.style.maxWidth = "100vw";
      
      // 强制 Cesium 重新调整大小
      if (viewer && viewer.scene && viewer.scene.canvas) {
        viewer.scene.canvas.style.height = "100%";
        viewer.scene.canvas.style.width = "100%";
        viewer.scene.canvas.style.maxHeight = "100vh";
        viewer.scene.canvas.style.maxWidth = "100vw";
        viewer.resize();
      }
    }
  }
}

// 监听窗口大小变化
window.addEventListener('resize', () => {
  ensureCesiumContainerSize();
  if (viewer) {
    viewer.resize();
  }
});

// 页面加载完成后检查容器尺寸
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(ensureCesiumContainerSize, 100);
});

// 定时器引用，用于清理
let containerSizeInterval;
let cacheCleanupInterval;
let performanceStatsInterval;

// 定期检查容器尺寸（防止异常增长）
containerSizeInterval = setInterval(ensureCesiumContainerSize, 5000);

// 缓存声明 - 必须在使用前声明
const materialCache = new Map();
const geometryCache = new Map();
const axisEndpointsCache = new Map();

// 定期清理无效缓存
cacheCleanupInterval = setInterval(() => {
  // 清理轴端点缓存中的无效数据
  for (const [key, data] of axisEndpointsCache) {
    if (!isValidCachedData(data)) {
      axisEndpointsCache.delete(key);
    }
  }
  
  // 清理几何缓存中的无效数据
  for (const [key, data] of geometryCache) {
    if (!data || !data.vertices || !data.edges || !data.faces) {
      geometryCache.delete(key);
    }
  }
  
  // 清理材质缓存（材质缓存通常不会有无效数据，但为了安全起见）
  if (materialCache.size > 200) {
    const keys = Array.from(materialCache.keys());
    for (let i = 0; i < Math.min(50, keys.length); i++) {
      materialCache.delete(keys[i]);
    }
  }
}, 10000); // 每10秒清理一次

viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.skyAtmosphere.brightnessShift = 0.15;

const PLANE_AXIS_MAP = {
  x: "yz",
  y: "xz",
  z: "xy",
};

const PLANE_NORMAL_AXIS = {
  xy: "z",
  yz: "x",
  xz: "y",
};

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
  objectMode: "object",
  componentMode: "face",
  selectedComponent: null,
  proportionalEditing: false,
  proportionalRadius: 15,
  proportionalIndicator: null,
  cameraNavigationActive: false,
  modifierCounter: 0,
  viewRingSession: null,
  skipNextClick: false,

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
const objectModeButton = document.getElementById("object-mode-button");
const editModeButton = document.getElementById("edit-mode-button");
const componentSwitch = document.getElementById("component-switch");
const componentButtons = componentSwitch
  ? Array.from(componentSwitch.querySelectorAll(".component-button"))
  : [];
const proportionalToggle = document.getElementById("proportional-toggle");
const proportionalRadiusInput = document.getElementById("proportional-radius");
const proportionalRadiusValue = document.getElementById("proportional-radius-value");
const proportionalControls = document.getElementById("proportional-controls");
const modifierTemplate = document.getElementById("modifier-template");
const modifierAddButton = document.getElementById("modifier-add");
const modifierList = document.getElementById("modifier-list");


const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

function getPickedMetadata(picked) {
  if (!picked) return null;
  if (picked.gizmoMetadata) return picked.gizmoMetadata;
  if (picked.cubeMetadata) return picked.cubeMetadata;
  return null;
}

function beginViewRingSession(pickedEntity, position) {
  if (!pickedEntity || !position) return false;
  const metadata = getPickedMetadata(pickedEntity);
  if (!metadata || metadata.mode !== "view") {
    return false;
  }

  if (appState.mode !== "view") {
    return false;
  }

  const target = metadata.target || appState.selectedObject || appState.gizmo?.entity;
  if (!target) {
    return false;
  }

  const julianNow = Cesium.JulianDate.now();
  const targetPosition = getEntityPosition(target, julianNow, new Cesium.Cartesian3());
  if (!targetPosition) {
    return false;
  }

  const cameraPosition = Cesium.Cartesian3.clone(viewer.camera.positionWC, new Cesium.Cartesian3());
  const offset = Cesium.Cartesian3.subtract(cameraPosition, targetPosition, new Cesium.Cartesian3());
  let range = Cesium.Cartesian3.magnitude(offset);
  if (!Number.isFinite(range) || range < 1.0) {
    range = 1.0;
  }

  const startPosition = Cesium.Cartesian2.clone(position, new Cesium.Cartesian2());
  const session = {
    target,
    targetPosition,
    startHeading: viewer.camera.heading,
    startPitch: viewer.camera.pitch,
    range,
    startPosition,
    lastPosition: Cesium.Cartesian2.clone(position, new Cesium.Cartesian2()),
    headingOffset: 0,
    pitchOffset: 0,
    ringEntity: pickedEntity,
    originalMaterial: null,
    originalWidth: null,
  };

  if (pickedEntity.polyline) {
    session.originalMaterial = pickedEntity.polyline.material;
    session.originalWidth = pickedEntity.polyline.width;
    pickedEntity.polyline.material = Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.9);
    pickedEntity.polyline.width = (pickedEntity.polyline.width || 2) * 1.4;
  }

  appState.viewRingSession = session;
  appState.cameraNavigationActive = true;
  viewer.scene.canvas.style.cursor = "grabbing";

  viewer.camera.lookAt(
    session.targetPosition,
    new Cesium.HeadingPitchRange(session.startHeading, session.startPitch, session.range)
  );
  return true;
}

function updateViewRingSession(movement) {
  const session = appState.viewRingSession;
  if (!session) return;
  const current = movement?.endPosition || movement?.position;
  if (!current) return;

  if (!session.lastPosition) {
    session.lastPosition = Cesium.Cartesian2.clone(current, new Cesium.Cartesian2());
  }

  const deltaX = current.x - session.lastPosition.x;
  const deltaY = current.y - session.lastPosition.y;
  session.lastPosition = Cesium.Cartesian2.clone(current, new Cesium.Cartesian2());

  const headingSensitivity = 0.0055;
  const pitchSensitivity = 0.005;

  session.headingOffset -= deltaX * headingSensitivity;
  session.pitchOffset -= deltaY * pitchSensitivity;

  const maxPitch = Cesium.Math.PI_OVER_TWO - Cesium.Math.toRadians(1.0);
  const newPitch = Cesium.Math.clamp(
    session.startPitch + session.pitchOffset,
    -maxPitch,
    maxPitch
  );
  const newHeading = session.startHeading + session.headingOffset;

  viewer.camera.lookAt(
    session.targetPosition,
    new Cesium.HeadingPitchRange(newHeading, newPitch, session.range)
  );
}

function endViewRingSession({ cancelled = false } = {}) {
  const session = appState.viewRingSession;
  if (!session) return false;

  if (session.ringEntity?.polyline) {
    if (session.originalMaterial) {
      session.ringEntity.polyline.material = session.originalMaterial;
    }
    if (session.originalWidth != null) {
      session.ringEntity.polyline.width = session.originalWidth;
    }
  }

  viewer.scene.canvas.style.cursor = "";
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  appState.viewRingSession = null;
  appState.cameraNavigationActive = false;

  if (cancelled) {
    appState.skipNextClick = false;
  }

  if (!cancelled) {
    refreshGizmoHighlight();
  }
  return true;
}

let gizmoEntities = [];

const GRID_STEP = 1.0;
const SHIFT_SLOW_RATIO = 0.2;

let objectCounter = 0;

const defaultCubeConfig = {
  dimensions: new Cesium.Cartesian3(20.0, 20.0, 20.0),
  color: Cesium.Color.fromCssColorString("#4f46e5").withAlpha(0.8),
  outlineColor: Cesium.Color.fromCssColorString("#ffb454"),
};

const VERTEX_SIGNS = [
  { x: 1, y: 1, z: 1 },
  { x: 1, y: 1, z: -1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: -1, z: -1 },
  { x: -1, y: 1, z: 1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: -1, y: -1, z: -1 },
];

const EDGE_DEFS = [
  { vertices: [0, 1] },
  { vertices: [0, 2] },
  { vertices: [0, 4] },
  { vertices: [3, 1] },
  { vertices: [3, 2] },
  { vertices: [3, 7] },
  { vertices: [5, 1] },
  { vertices: [5, 4] },
  { vertices: [5, 7] },
  { vertices: [6, 2] },
  { vertices: [6, 4] },
  { vertices: [6, 7] },
];

const FACE_DEFS = [
  { vertices: [0, 2, 3, 1], signs: { x: 1, y: 0, z: 0 } },
  { vertices: [4, 5, 7, 6], signs: { x: -1, y: 0, z: 0 } },
  { vertices: [0, 1, 5, 4], signs: { x: 0, y: 1, z: 0 } },
  { vertices: [2, 6, 7, 3], signs: { x: 0, y: -1, z: 0 } },
  { vertices: [0, 4, 6, 2], signs: { x: 0, y: 0, z: 1 } },
  { vertices: [1, 3, 7, 5], signs: { x: 0, y: 0, z: -1 } },
];

const MODIFIER_LIBRARY = {
  subdivision: {
    label: "细分曲面",
    params: { level: 1 },
    range: { key: "level", min: 1, max: 5, step: 1 },
  },
  bevel: {
    label: "倒角",
    params: { amount: 0.35 },
    range: { key: "amount", min: 0, max: 1, step: 0.05 },
  },
  solidify: {
    label: "实体化",
    params: { thickness: 0.5 },
    range: { key: "thickness", min: 0, max: 2, step: 0.1 },
  },
};


if (xrayToggle) {
  xrayToggle.checked = appState.viewSettings.xray;
}
if (selectionFilter) {
  selectionFilter.value = appState.selectionFilter;
}
updateSelectionFilterMessage();

function getEntityPosition(entity, julian = Cesium.JulianDate.now(), result) {
  if (!entity) {
    return result ? Cesium.Cartesian3.clone(Cesium.Cartesian3.ZERO, result) : Cesium.Cartesian3.ZERO.clone();
  }
  
  const { position } = entity;
  let pos;
  
  if (position && typeof position.getValue === "function") {
    pos = position.getValue(julian, result || new Cesium.Cartesian3());
  } else if (position) {
    pos = Cesium.Cartesian3.clone(position, result || new Cesium.Cartesian3());
  } else {
    pos = Cesium.Cartesian3.ZERO.clone();
  }
  
  // 验证位置是否有效
  if (!pos || !Cesium.defined(pos.x) || !Cesium.defined(pos.y) || !Cesium.defined(pos.z) ||
      !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
    return result ? Cesium.Cartesian3.clone(Cesium.Cartesian3.ZERO, result) : Cesium.Cartesian3.ZERO.clone();
  }
  
  return pos;
}

function getEntityOrientation(entity, julian = Cesium.JulianDate.now()) {
  if (!entity || !Cesium.defined(entity.orientation)) {
    return Cesium.Quaternion.IDENTITY;
  }
  const { orientation } = entity;
  let quat;
  
  if (orientation && typeof orientation.getValue === "function") {
    quat = orientation.getValue(julian, new Cesium.Quaternion());
  } else if (orientation instanceof Cesium.Quaternion) {
    quat = orientation;
  } else if (
    orientation &&
    typeof orientation.x === "number" &&
    typeof orientation.y === "number" &&
    typeof orientation.z === "number" &&
    typeof orientation.w === "number"
  ) {
    quat = new Cesium.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
  } else {
    quat = Cesium.Quaternion.IDENTITY;
  }
  
  // 验证四元数是否有效
  if (!quat || !Cesium.defined(quat.x) || !Cesium.defined(quat.y) || !Cesium.defined(quat.z) || !Cesium.defined(quat.w) ||
      !isFinite(quat.x) || !isFinite(quat.y) || !isFinite(quat.z) || !isFinite(quat.w)) {
    return Cesium.Quaternion.IDENTITY;
  }
  
  // 确保四元数是单位四元数
  const magnitude = Math.sqrt(quat.x * quat.x + quat.y * quat.y + quat.z * quat.z + quat.w * quat.w);
  if (magnitude === 0) {
    return Cesium.Quaternion.IDENTITY;
  }
  
  return Cesium.Quaternion.normalize(quat, new Cesium.Quaternion());
}

function getEntityDimensions(entity, julian = Cesium.JulianDate.now()) {
  if (!entity || !entity.box || !entity.box.dimensions) {
    return null;
  }
  const { dimensions } = entity.box;
  if (dimensions && typeof dimensions.getValue === "function") {
    return dimensions.getValue(julian, new Cesium.Cartesian3());
  }
  if (
    dimensions &&
    typeof dimensions.x === "number" &&
    typeof dimensions.y === "number" &&
    typeof dimensions.z === "number"
  ) {
    return dimensions;
  }
  return null;
}

function isPlaneConstraint(axis) {
  return axis === "xy" || axis === "yz" || axis === "xz";
}

function getPlaneAxes(axis) {
  if (!isPlaneConstraint(axis)) return [];
  return axis.split("");
}

function getPlaneNormalAxis(axis) {
  return PLANE_NORMAL_AXIS[axis] || "z";
}

function computeProportionalWeight(distance, radius) {
  if (!Cesium.defined(radius) || radius <= Cesium.Math.EPSILON7) {
    return 0;
  }
  const t = Cesium.Math.clamp(1 - distance / radius, 0, 1);
  return t * t * (3 - 2 * t);
}


function updateModeIndicator() {
  const labels = {
    view: "视图",
    translate: "移动",
    rotate: "旋转",
    scale: "缩放",
    create: "创建",
  };
  const label = labels[appState.mode] || appState.mode;
  const scope = appState.objectMode === "edit" ? "编辑" : "对象";
  modeIndicator.textContent = `模式：${scope} · ${label}`;

}

function updateAxisIndicator() {
  if (appState.axisMode === "none") {
    axisIndicator.textContent = "轴向：自由";
  } else {
    const space = appState.axisSpace === "local" ? "本地" : "全局";
    const label = isPlaneConstraint(appState.axisMode)
      ? `${appState.axisMode.toUpperCase()} 平面`
      : appState.axisMode.toUpperCase();
    axisIndicator.textContent = `轴向：${label} (${space})`;

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

// 验证四元数是否有效
function isValidQuaternion(quat) {
  if (!quat || !Cesium.defined(quat.x) || !Cesium.defined(quat.y) || !Cesium.defined(quat.z) || !Cesium.defined(quat.w)) {
    return false;
  }
  
  if (!isFinite(quat.x) || !isFinite(quat.y) || !isFinite(quat.z) || !isFinite(quat.w)) {
    return false;
  }
  
  // 检查四元数是否为零向量
  const magnitude = Math.sqrt(quat.x * quat.x + quat.y * quat.y + quat.z * quat.z + quat.w * quat.w);
  return magnitude > 0;
}

// 验证 Cartesian3 是否有效
function isValidCartesian3(vec) {
  if (!vec || !Cesium.defined(vec.x) || !Cesium.defined(vec.y) || !Cesium.defined(vec.z)) {
    return false;
  }
  
  if (!isFinite(vec.x) || !isFinite(vec.y) || !isFinite(vec.z)) {
    return false;
  }
  
  return true;
}

// 验证 Matrix4 是否有效
function isValidMatrix4(mat) {
  if (!mat || !Cesium.defined(mat)) {
    return false;
  }
  
  // 检查矩阵的每个元素
  for (let i = 0; i < 16; i++) {
    const value = mat[i];
    if (!Cesium.defined(value) || !isFinite(value)) {
      return false;
    }
  }
  
  return true;
}

// 验证相机位置是否安全
function isCameraPositionSafe(position) {
  if (!isValidCartesian3(position)) {
    return false;
  }
  
  // 检查高度是否合理（不能太高或太低）
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  if (!cartographic) {
    return false;
  }
  
  const height = cartographic.height;
  // 放宽高度限制，允许更广的范围
  return height > -10000 && height < 1000000; // 高度在 -10km 到 1000km 之间
}

function getAxisVector(axis, space, entity) {
  if (!entity) {
    return Cesium.Cartesian3.ZERO;
  }
  
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

  if (space === "local") {
    const orientation = getEntityOrientation(entity);
    if (!orientation || !isValidQuaternion(orientation)) {
      return unit; // 返回默认轴向量
    }
    
    const orientationMatrix = Cesium.Matrix3.fromQuaternion(orientation, new Cesium.Matrix3());
    const rotated = Cesium.Matrix3.multiplyByVector(orientationMatrix, unit, new Cesium.Cartesian3());
    
    // 验证旋转结果
    if (!rotated || !Cesium.defined(rotated.x) || !Cesium.defined(rotated.y) || !Cesium.defined(rotated.z) ||
        !isFinite(rotated.x) || !isFinite(rotated.y) || !isFinite(rotated.z)) {
      return unit; // 返回默认轴向量
    }
    
    const normalized = Cesium.Cartesian3.normalize(rotated, rotated);
    return normalized && isValidCartesian3(normalized) ? normalized : unit;
  }

  const position = getEntityPosition(entity);
  if (!position || !isValidCartesian3(position)) {
    return unit; // 返回默认轴向量
  }
  
  const enu = getEastNorthUpMatrix(position);
  if (!enu || !isValidMatrix4(enu)) {
    return unit; // 返回默认轴向量
  }

  const vector = Cesium.Matrix4.getColumn(enu, axis === "x" ? 0 : axis === "y" ? 1 : 2, new Cesium.Cartesian3());
  
  // 验证向量
  if (!vector || !Cesium.defined(vector.x) || !Cesium.defined(vector.y) || !Cesium.defined(vector.z) ||
      !isFinite(vector.x) || !isFinite(vector.y) || !isFinite(vector.z)) {
    return unit; // 返回默认轴向量
  }
  
  const normalized = Cesium.Cartesian3.normalize(vector, vector);
  return normalized && isValidCartesian3(normalized) ? normalized : unit;
}

function getEntityAxes(entity) {
  const julian = Cesium.JulianDate.now();
  const orientation = getEntityOrientation(entity, julian);
  const matrix = Cesium.Matrix3.fromQuaternion(orientation, new Cesium.Matrix3());
  const xAxis = Cesium.Matrix3.getColumn(matrix, 0, new Cesium.Cartesian3());
  const yAxis = Cesium.Matrix3.getColumn(matrix, 1, new Cesium.Cartesian3());
  const zAxis = Cesium.Matrix3.getColumn(matrix, 2, new Cesium.Cartesian3());
  return {
    x: Cesium.Cartesian3.normalize(xAxis, xAxis),
    y: Cesium.Cartesian3.normalize(yAxis, yAxis),
    z: Cesium.Cartesian3.normalize(zAxis, zAxis),
  };
}

function computeWorldDirectionFromSigns(signs, entity) {
  const axes = getEntityAxes(entity);
  const direction = new Cesium.Cartesian3();
  if (signs.x) {
    Cesium.Cartesian3.add(
      direction,
      Cesium.Cartesian3.multiplyByScalar(axes.x, signs.x, new Cesium.Cartesian3()),
      direction
    );
  }
  if (signs.y) {
    Cesium.Cartesian3.add(
      direction,
      Cesium.Cartesian3.multiplyByScalar(axes.y, signs.y, new Cesium.Cartesian3()),
      direction
    );
  }
  if (signs.z) {
    Cesium.Cartesian3.add(
      direction,
      Cesium.Cartesian3.multiplyByScalar(axes.z, signs.z, new Cesium.Cartesian3()),
      direction
    );
  }
  if (Cesium.Cartesian3.magnitude(direction) < Cesium.Math.EPSILON6) {
    return axes.x;
  }
  return Cesium.Cartesian3.normalize(direction, direction);
}

function computeSignsMagnitude(signs) {
  return Math.sqrt((signs.x || 0) ** 2 + (signs.y || 0) ** 2 + (signs.z || 0) ** 2) || 1;
}


function colorToHex(color) {
  if (!color) return "#ffffff";
  const r = Cesium.Math.clamp(Math.round(color.red * 255), 0, 255);
  const g = Cesium.Math.clamp(Math.round(color.green * 255), 0, 255);
  const b = Cesium.Math.clamp(Math.round(color.blue * 255), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function cloneColor(color) {
  if (!color) return Cesium.Color.WHITE.clone();
  return color.clone(new Cesium.Color());
}

function brightenColor(color, amount) {
  const base = cloneColor(color);
  base.red = Cesium.Math.clamp(base.red + amount, 0, 1);
  base.green = Cesium.Math.clamp(base.green + amount, 0, 1);
  base.blue = Cesium.Math.clamp(base.blue + amount, 0, 1);
  return base;
}

function tintColor(color, target, factor) {
  const base = cloneColor(color);
  const targetColor = target ? cloneColor(target) : Cesium.Color.WHITE;
  base.red = Cesium.Math.clamp(base.red + (targetColor.red - base.red) * factor, 0, 1);
  base.green = Cesium.Math.clamp(base.green + (targetColor.green - base.green) * factor, 0, 1);
  base.blue = Cesium.Math.clamp(base.blue + (targetColor.blue - base.blue) * factor, 0, 1);
  return base;
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

// 材质缓存已在上面声明

function applyMaterial(entity, options = {}) {
  if (!entity || !entity.cubeMetadata) return;
  if (appState.transformSession && appState.transformSession.entity === entity && options.force !== true) {
    return;
  }

  const metadata = entity.cubeMetadata;
  const baseColor = metadata.runtimeColor || metadata.color || defaultCubeConfig.color;
  const outlineColor = metadata.runtimeOutline || metadata.outlineColor || defaultCubeConfig.outlineColor;
  
  // 确保颜色对象是 Cesium Color 类型
  const safeBaseColor = baseColor instanceof Cesium.Color ? baseColor : defaultCubeConfig.color;
  const safeOutlineColor = outlineColor instanceof Cesium.Color ? outlineColor : defaultCubeConfig.outlineColor;
  const fillEnabled = metadata.fillEnabled !== false;
  const outlineEnabled = metadata.outlineEnabled !== false;
  const baseOpacityValue = metadata.runtimeOpacity ?? metadata.opacity ?? safeBaseColor.alpha ?? 0.8;
  const baseOpacity = Cesium.Math.clamp(baseOpacityValue, 0.05, 1.0);

  let finalAlpha = baseOpacity;
  if (appState.viewSettings.xray) {
    finalAlpha = Math.min(finalAlpha, 0.35);
  }
  if (options.selected) {
    const highlightFloor = appState.viewSettings.xray ? 0.55 : 0.7;
    finalAlpha = Math.max(finalAlpha, highlightFloor);
    finalAlpha = Math.min(finalAlpha, 1.0);
  }

  // 创建材质缓存键
  const materialKey = `${entity.id}_${safeBaseColor.red}_${safeBaseColor.green}_${safeBaseColor.blue}_${finalAlpha}_${fillEnabled}_${outlineEnabled}_${options.selected}_${appState.viewSettings.xray}`;
  
  // 检查材质缓存
  let material = materialCache.get(materialKey);
  if (!material) {
    material = new Cesium.ColorMaterialProperty(safeBaseColor.withAlpha(finalAlpha));
    // 限制缓存大小
    if (materialCache.size > 100) {
      const firstKey = materialCache.keys().next().value;
      materialCache.delete(firstKey);
    }
    materialCache.set(materialKey, material);
  }

  entity.box.fill = fillEnabled;
  entity.box.material = material;
  entity.box.outline = outlineEnabled || options.selected;
  const displayOutlineColor = options.selected ? Cesium.Color.ORANGE : safeOutlineColor;
  entity.box.outlineColor = displayOutlineColor.withAlpha(appState.viewSettings.xray ? 0.6 : 1.0);
}

function refreshAllMaterials() {
  appState.objects.forEach((entity) => {
    const isSelected = entity === appState.selectedObject && !appState.transformSession;
    applyModifiers(entity);

    applyMaterial(entity, { selected: isSelected, force: true });
  });
}

function applyModifiers(entity) {
  if (!entity || !entity.cubeMetadata) return;
  const metadata = entity.cubeMetadata;
  const modifiers = metadata.modifiers || [];
  if (modifiers.length === 0) {
    metadata.runtimeColor = null;
    metadata.runtimeOutline = null;
    metadata.runtimeOpacity = null;
    return;
  }

  let workingColor = cloneColor(metadata.color || defaultCubeConfig.color);
  let workingOutline = cloneColor(metadata.outlineColor || defaultCubeConfig.outlineColor);
  let workingOpacity = metadata.opacity ?? workingColor.alpha ?? 0.8;

  modifiers.forEach((modifier) => {
    if (!modifier || modifier.enabled === false) return;
    switch (modifier.type) {
      case "subdivision": {
        const level = Cesium.Math.clamp(modifier.params?.level ?? 1, 1, 5);
        const amount = level * 0.05;
        workingColor = brightenColor(workingColor, amount);
        break;
      }
      case "bevel": {
        const amount = Cesium.Math.clamp(modifier.params?.amount ?? 0.35, 0, 1);
        const target = Cesium.Color.fromCssColorString("#fbbf24");
        workingOutline = tintColor(workingOutline, target, amount * 0.4);
        break;
      }
      case "solidify": {
        const thickness = Cesium.Math.clamp(modifier.params?.thickness ?? 0.5, 0, 2);
        workingOpacity = Cesium.Math.clamp(workingOpacity + thickness * 0.05, 0.05, 1.0);
        break;
      }
      default:
        break;
    }
  });

  metadata.runtimeColor = workingColor;
  metadata.runtimeOutline = workingOutline;
  metadata.runtimeOpacity = workingOpacity;
}


function updatePropertyPanel(entity) {
  if (!propertyPanel) return;
  if (!entity) {
    propertyContent.classList.add("hidden");
    propertyEmpty.classList.remove("hidden");
    propertyName.textContent = "";
    propertyId.textContent = "";
    renderModifierList(null);

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
  renderModifierList(entity);

}

function isSelectionAllowed(entity) {
  if (appState.selectionFilter === "all") return true;
  const type = entity?.cubeMetadata?.type || "object";
  return type === appState.selectionFilter;
}

function renderModifierList(entity) {
  if (!modifierList) return;
  modifierList.innerHTML = "";

  if (!entity || !entity.cubeMetadata) {
    const empty = document.createElement("li");
    empty.className = "modifier-empty";
    empty.textContent = "选择对象以管理修改器。";
    modifierList.appendChild(empty);
    return;
  }

  const metadata = entity.cubeMetadata;
  const modifiers = metadata.modifiers || [];
  if (modifiers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "modifier-empty";
    empty.textContent = "暂无修改器。使用上方下拉菜单添加。";
    modifierList.appendChild(empty);
    return;
  }

  modifiers.forEach((modifier, index) => {
    const config = MODIFIER_LIBRARY[modifier.type];
    const item = document.createElement("li");
    item.className = "modifier-item";
    if (modifier.enabled === false) {
      item.classList.add("disabled");
    }

    const title = document.createElement("div");
    title.className = "modifier-title";
    title.textContent = config?.label || modifier.type;

    const params = document.createElement("div");
    params.className = "modifier-params";
    if (config?.range) {
      const rangeWrapper = document.createElement("label");
      rangeWrapper.textContent = "强度";
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(config.range.min);
      range.max = String(config.range.max);
      range.step = String(config.range.step ?? 0.1);
      const key = config.range.key;
      const current = modifier.params?.[key] ?? config.range.min;
      range.value = String(current);
      const output = document.createElement("span");
      output.textContent = Number(current).toFixed(2);
      range.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        modifier.params = { ...modifier.params, [key]: value };
        output.textContent = Number(value).toFixed(2);
        applyModifiers(entity);
        applyMaterial(entity, { selected: entity === appState.selectedObject, force: true });
      });
      rangeWrapper.appendChild(range);
      rangeWrapper.appendChild(output);
      params.appendChild(rangeWrapper);
    }

    const controls = document.createElement("div");
    controls.className = "modifier-controls";

    const toggle = document.createElement("button");
    toggle.textContent = modifier.enabled === false ? "启用" : "禁用";
    toggle.addEventListener("click", () => {
      modifier.enabled = modifier.enabled === false;
      renderModifierList(entity);
      applyModifiers(entity);
      applyMaterial(entity, { selected: entity === appState.selectedObject, force: true });
    });

    const up = document.createElement("button");
    up.textContent = "上移";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      if (index === 0) return;
      [modifiers[index - 1], modifiers[index]] = [modifiers[index], modifiers[index - 1]];
      renderModifierList(entity);
      applyModifiers(entity);
      applyMaterial(entity, { selected: entity === appState.selectedObject, force: true });
    });

    const down = document.createElement("button");
    down.textContent = "下移";
    down.disabled = index === modifiers.length - 1;
    down.addEventListener("click", () => {
      if (index === modifiers.length - 1) return;
      [modifiers[index + 1], modifiers[index]] = [modifiers[index], modifiers[index + 1]];
      renderModifierList(entity);
      applyModifiers(entity);
      applyMaterial(entity, { selected: entity === appState.selectedObject, force: true });
    });

    const remove = document.createElement("button");
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      modifiers.splice(index, 1);
      renderModifierList(entity);
      applyModifiers(entity);
      applyMaterial(entity, { selected: entity === appState.selectedObject, force: true });
    });

    controls.appendChild(toggle);
    controls.appendChild(up);
    controls.appendChild(down);
    controls.appendChild(remove);

    item.appendChild(title);
    item.appendChild(params);
    item.appendChild(controls);
    modifierList.appendChild(item);
  });
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

  applyModifiers(entity);
  applyMaterial(entity, { selected: true, force: true });
}


function createCube(position, options = {}) {
  // 验证位置是否有效
  if (!position || !isValidCartesian3(position)) {
    console.warn("无效的立方体位置，使用默认位置");
    position = Cesium.Cartesian3.fromDegrees(0, 0, 100);
  }

  const id = ++objectCounter;
  const name = `Cube_${id}`;
  const dimensions = options.dimensions || defaultCubeConfig.dimensions;
  const color = options.color || defaultCubeConfig.color;
  const outlineColor = options.outlineColor || defaultCubeConfig.outlineColor;

  // 确保尺寸有效
  const safeDimensions = isValidCartesian3(dimensions) ? dimensions : defaultCubeConfig.dimensions;
  const safeColor = color instanceof Cesium.Color ? color : defaultCubeConfig.color;
  const safeOutlineColor = outlineColor instanceof Cesium.Color ? outlineColor : defaultCubeConfig.outlineColor;

  const cubeEntity = viewer.entities.add({
    id: name,
    name,
    position,
    orientation: Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll()),
    box: {
      dimensions: Cesium.Cartesian3.clone(safeDimensions),
      material: safeColor,
      outline: true,
      outlineColor: safeOutlineColor,
    },
  });

  cubeEntity.cubeMetadata = {
    dimensions: Cesium.Cartesian3.clone(safeDimensions),
    color: safeColor,
    outlineColor: safeOutlineColor,
    opacity: options.opacity ?? safeColor.alpha ?? 0.8,
    outlineEnabled: true,
    fillEnabled: true,
    type: "mesh",
    label: options.label || "",
    modifiers: [],
  };

  appState.objects.set(name, cubeEntity);
  
  // 延迟应用材质和选择，确保实体完全创建
  setTimeout(() => {
    if (viewer.entities.contains(cubeEntity)) {
      applyModifiers(cubeEntity);
      applyMaterial(cubeEntity, { selected: true, force: true });
      setSelectedObject(cubeEntity);
      openParameterPanel();
    }
  }, 50);

  // 延迟聚焦，避免闪烁
  focusOnEntity(cubeEntity);
  
  return cubeEntity;
}

// 几何计算缓存已在上面声明

function computeCubeGeometry(entity) {
  if (!entity || !entity.box) return { vertices: [], edges: [], faces: [] };
  
  try {
    const julian = Cesium.JulianDate.now();
    const dims = entity.box.dimensions.getValue(julian);
    const position = getEntityPosition(entity, julian, new Cesium.Cartesian3());
    const orientation = getEntityOrientation(entity, julian);
    
    // 验证输入数据
    if (!dims || !Cesium.defined(dims.x) || !Cesium.defined(dims.y) || !Cesium.defined(dims.z) ||
        !isFinite(dims.x) || !isFinite(dims.y) || !isFinite(dims.z) ||
        dims.x <= 0 || dims.y <= 0 || dims.z <= 0 ||
        dims.x > 10000 || dims.y > 10000 || dims.z > 10000) {
      console.warn("无效的立方体尺寸:", dims);
      return { vertices: [], edges: [], faces: [] };
    }
    
    if (!position || !Cesium.defined(position.x) || !Cesium.defined(position.y) || !Cesium.defined(position.z) ||
        !isFinite(position.x) || !isFinite(position.y) || !isFinite(position.z)) {
      console.warn("无效的实体位置:", position);
      return { vertices: [], edges: [], faces: [] };
    }
    
    if (!orientation || !Cesium.defined(orientation.x) || !Cesium.defined(orientation.y) || 
        !Cesium.defined(orientation.z) || !Cesium.defined(orientation.w) ||
        !isFinite(orientation.x) || !isFinite(orientation.y) || !isFinite(orientation.z) || !isFinite(orientation.w)) {
      console.warn("无效的实体方向:", orientation);
      return { vertices: [], edges: [], faces: [] };
    }
    
    // 创建缓存键
    const cacheKey = `${entity.id}_${dims.x}_${dims.y}_${dims.z}_${position.x}_${position.y}_${position.z}_${orientation.x}_${orientation.y}_${orientation.z}_${orientation.w}`;
    
    // 检查缓存
    if (geometryCache.has(cacheKey)) {
      return geometryCache.get(cacheKey);
    }
  
    const half = new Cesium.Cartesian3(dims.x / 2, dims.y / 2, dims.z / 2);
    const matrix = Cesium.Matrix3.fromQuaternion(orientation, new Cesium.Matrix3());

    const vertices = VERTEX_SIGNS.map((signs, index) => {
      const local = new Cesium.Cartesian3(half.x * signs.x, half.y * signs.y, half.z * signs.z);
      const rotated = Cesium.Matrix3.multiplyByVector(matrix, local, new Cesium.Cartesian3());
      const world = Cesium.Cartesian3.add(position, rotated, new Cesium.Cartesian3());
      return {
        index,
        position: world,
        signs,
      };
    });

    const faces = FACE_DEFS.map((def, index) => {
      const faceVertices = def.vertices.map((vertexIndex) => vertices[vertexIndex].position);
      const center = faceVertices.reduce(
        (acc, current) => Cesium.Cartesian3.add(acc, current, acc),
        new Cesium.Cartesian3()
      );
      Cesium.Cartesian3.divideByScalar(center, faceVertices.length, center);
      return {
        index,
        vertices: faceVertices,
        center,
        signs: def.signs,
        normal: computeWorldDirectionFromSigns(def.signs, entity),
      };
    });

    const edges = EDGE_DEFS.map((def, index) => {
      const [startIndex, endIndex] = def.vertices;
      const start = vertices[startIndex];
      const end = vertices[endIndex];
      const center = Cesium.Cartesian3.midpoint(start.position, end.position, new Cesium.Cartesian3());
      const signs = {
        x: Math.sign((start.signs.x || 0) + (end.signs.x || 0)),
        y: Math.sign((start.signs.y || 0) + (end.signs.y || 0)),
        z: Math.sign((start.signs.z || 0) + (end.signs.z || 0)),
      };
      return {
        index,
        start: start.position,
        end: end.position,
        center,
        signs,
        normal: computeWorldDirectionFromSigns(signs, entity),
      };
    });

    const result = { vertices, edges, faces };
    
    // 缓存结果，限制缓存大小
    if (geometryCache.size > 50) {
      const firstKey = geometryCache.keys().next().value;
      geometryCache.delete(firstKey);
    }
    geometryCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    console.error("几何计算错误:", error);
    return { vertices: [], edges: [], faces: [] };
  }
}

function removeObjectById(id) {
  if (!appState.objects.has(id)) return false;
  const entity = appState.objects.get(id);
  if (appState.selectedObject === entity) {
    setSelectedObject(null);
  }
  const removed = viewer.entities.remove(entity);
  appState.objects.delete(id);
  
  // 清理几何缓存中相关的条目
  if (entity && entity.id) {
    for (const [key] of geometryCache) {
      if (key.startsWith(`${entity.id}_`)) {
        geometryCache.delete(key);
      }
    }
    
    // 清理材质缓存中相关的条目
    for (const [key] of materialCache) {
      if (key.startsWith(`${entity.id}_`)) {
        materialCache.delete(key);
      }
    }
  }
  
  return removed;
}

function getSpawnPosition() {
  const canvas = viewer.scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let pick;
  
  // 尝试从屏幕中心拾取地面位置
  if (viewer.scene.pickPositionSupported) {
    pick = viewer.scene.pickPosition(center);
  }
  
  // 如果拾取失败，尝试从相机射线拾取
  if (!Cesium.defined(pick)) {
    const ray = viewer.camera.getPickRay(center);
    if (Cesium.defined(ray)) {
      pick = viewer.scene.globe.pick(ray, viewer.scene);
    }
  }
  
  // 如果拾取成功，验证位置是否有效
  if (Cesium.defined(pick) && isValidCartesian3(pick)) {
    return pick;
  }
  
  // 如果拾取失败，使用相机前方位置
  let cameraPosition = viewer.camera.positionWC;
  if (!isValidCartesian3(cameraPosition)) {
    // 如果相机位置无效，使用默认位置
    return Cesium.Cartesian3.fromDegrees(0, 0, 100);
  }
  
  const normal = getSurfaceNormal(cameraPosition);
  if (!isValidCartesian3(normal)) {
    // 如果法向量无效，使用默认方向
    return Cesium.Cartesian3.add(
      cameraPosition,
      Cesium.Cartesian3.multiplyByScalar(Cesium.Cartesian3.UNIT_Z, -30.0, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
  }
  
  const spawnPos = Cesium.Cartesian3.add(
    cameraPosition,
    Cesium.Cartesian3.multiplyByScalar(normal, -30.0, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  
  // 验证最终位置
  if (isValidCartesian3(spawnPos)) {
    return spawnPos;
  }
  
  // 如果所有方法都失败，返回相机前方安全位置
  cameraPosition = viewer.camera.positionWC;
  if (isValidCartesian3(cameraPosition)) {
    const direction = viewer.camera.direction;
    const up = viewer.camera.up;
    const right = viewer.camera.right;
    
    // 计算相机前方 100 米的位置
    const forward = Cesium.Cartesian3.multiplyByScalar(direction, -100, new Cesium.Cartesian3());
    const safePosition = Cesium.Cartesian3.add(cameraPosition, forward, new Cesium.Cartesian3());
    
    if (isValidCartesian3(safePosition)) {
      return safePosition;
    }
  }
  
  // 最后的备用方案
  return Cesium.Cartesian3.fromDegrees(0, 0, 100);
}

function focusOnEntity(entity) {
  // 延迟执行 flyTo，确保立方体已经完全创建和渲染
  setTimeout(() => {
    if (entity && viewer.entities.contains(entity)) {
      try {
        // 获取实体位置
        const julianNow = Cesium.JulianDate.now();
        const entityPosition = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());
        
        // 验证位置是否有效
        if (!entityPosition || !isValidCartesian3(entityPosition)) {
          console.warn("实体位置无效，跳过相机飞行");
          return;
        }
        
        // 计算合适的相机距离
        const cameraPosition = viewer.camera.positionWC;
        const distance = Cesium.Cartesian3.distance(cameraPosition, entityPosition);
        const safeDistance = Math.max(50, Math.min(distance * 1.5, 500));
        
        // 使用更安全的飞行参数
        viewer.flyTo(entity, {
          offset: new Cesium.HeadingPitchRange(0, -0.3, safeDistance),
          duration: 1.0,
          maximumHeight: 50000, // 提高最大高度限制
          pitchAdjustHeight: 0, // 禁用俯仰调整
        }).then(() => {
          // 飞行完成后检查相机位置，但只在真正异常时才重置
          const finalPosition = viewer.camera.positionWC;
          if (!isValidCartesian3(finalPosition)) {
            console.warn("相机飞行后位置无效，重置相机");
            viewer.camera.setView({
              destination: Cesium.Cartesian3.fromDegrees(0, 0, 1000),
              orientation: {
                heading: 0.0,
                pitch: -Cesium.Math.PI_OVER_TWO,
                roll: 0.0
              }
            });
          } else if (!isCameraPositionSafe(finalPosition)) {
            // 只在位置明显异常时才重置
            console.warn("相机位置超出安全范围，但继续使用");
          }
        }).catch((error) => {
          console.warn("相机飞行失败:", error);
          // 如果飞行失败，使用 setView 作为备用方案
          viewer.camera.setView({
            destination: entityPosition,
            orientation: {
              heading: 0.0,
              pitch: -0.3,
              roll: 0.0
            }
          });
        });
      } catch (error) {
        console.warn("focusOnEntity 执行失败:", error);
      }
    }
  }, 100);
}

function ensureProportionalIndicator() {
  if (appState.proportionalIndicator) return;
  const indicator = viewer.entities.add({
    name: "proportional-indicator",
    show: false,
    allowPicking: false,
    ellipsoid: {
      radii: new Cesium.Cartesian3(appState.proportionalRadius, appState.proportionalRadius, appState.proportionalRadius),
      material: Cesium.Color.fromCssColorString("#a855f7").withAlpha(0.12),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#a855f7").withAlpha(0.45),
    },
  });
  indicator.cubeMetadata = { type: "helper" };
  appState.proportionalIndicator = indicator;
}

function updateProportionalIndicator() {
  ensureProportionalIndicator();
  const indicator = appState.proportionalIndicator;
  if (!indicator) return;
  const shouldShow =
    appState.objectMode === "edit" &&
    appState.proportionalEditing &&
    !!appState.selectedComponent &&
    !!appState.selectedComponent.center;
  indicator.show = shouldShow;
  if (!shouldShow) return;
  indicator.position = new Cesium.ConstantPositionProperty(
    Cesium.Cartesian3.clone(appState.selectedComponent.center, new Cesium.Cartesian3())
  );
  indicator.ellipsoid.radii = new Cesium.Cartesian3(
    appState.proportionalRadius,
    appState.proportionalRadius,
    appState.proportionalRadius
  );
}

function destroyComponentOverlays(entity) {
  if (!entity?.cubeMetadata?.componentOverlays) return;
  const overlays = entity.cubeMetadata.componentOverlays;
  overlays.all.forEach((overlay) => {
    if (overlay && !overlay.isDestroyed()) {
      viewer.entities.remove(overlay);
    }
  });
  entity.cubeMetadata.componentOverlays = null;
}

function applyComponentVisibility(entity) {
  const overlays = entity?.cubeMetadata?.componentOverlays;
  if (!overlays) return;
  overlays.all.forEach((overlay) => {
    if (!overlay?.componentMetadata) return;
    overlay.show = overlay.componentMetadata.kind === appState.componentMode;
  });
}

function rebuildComponentOverlays(entity, options = {}) {
  if (!entity?.cubeMetadata) return;
  const previous = options.preserveSelection ? appState.selectedComponent : null;
  const previousKey = previous ? { kind: previous.kind, index: previous.index } : null;
  destroyComponentOverlays(entity);
  const geometry = computeCubeGeometry(entity);
  const overlays = { vertex: [], edge: [], face: [], all: [] };

  geometry.vertices.forEach((vertex) => {
    const overlay = viewer.entities.add({
      name: `${entity.id}_vertex_${vertex.index}`,
      position: vertex.position,
      point: {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.95),
        outlineColor: Cesium.Color.fromCssColorString("#0f172a"),
        outlineWidth: 2,
      },
      show: appState.componentMode === "vertex",
    });
    overlay.cubeMetadata = { type: "component" };
    overlay.componentMetadata = {
      kind: "vertex",
      index: vertex.index,
      signs: vertex.signs,
      normal: computeWorldDirectionFromSigns(vertex.signs, entity),
      center: Cesium.Cartesian3.clone(vertex.position, new Cesium.Cartesian3()),
      overlay,
      owner: entity,
    };
    overlays.vertex.push(overlay);
    overlays.all.push(overlay);
  });

  geometry.edges.forEach((edge) => {
    const overlay = viewer.entities.add({
      name: `${entity.id}_edge_${edge.index}`,
      polyline: {
        positions: [edge.start, edge.end],
        width: 3,
        material: Cesium.Color.fromCssColorString("#38bdf8"),
      },
      show: appState.componentMode === "edge",
    });
    overlay.cubeMetadata = { type: "component" };
    overlay.componentMetadata = {
      kind: "edge",
      index: edge.index,
      signs: edge.signs,
      normal: computeWorldDirectionFromSigns(edge.signs, entity),
      center: Cesium.Cartesian3.clone(edge.center, new Cesium.Cartesian3()),
      overlay,
      owner: entity,
    };
    overlays.edge.push(overlay);
    overlays.all.push(overlay);
  });

  geometry.faces.forEach((face) => {
    const overlay = viewer.entities.add({
      name: `${entity.id}_face_${face.index}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(face.vertices),
        material: Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#2563eb").withAlpha(0.4),
      },
      show: appState.componentMode === "face",
    });
    overlay.cubeMetadata = { type: "component" };
    overlay.componentMetadata = {
      kind: "face",
      index: face.index,
      signs: face.signs,
      normal: face.normal,
      center: Cesium.Cartesian3.clone(face.center, new Cesium.Cartesian3()),
      overlay,
      owner: entity,
    };
    overlays.face.push(overlay);
    overlays.all.push(overlay);
  });

  entity.cubeMetadata.componentOverlays = overlays;
  applyComponentVisibility(entity);

  if (previousKey) {
    const restored = overlays.all.find(
      (overlay) =>
        overlay.componentMetadata &&
        overlay.componentMetadata.kind === previousKey.kind &&
        overlay.componentMetadata.index === previousKey.index
    );
    if (restored) {
      setComponentSelection(restored.componentMetadata, { silent: true });
      return;
    }
  }

  if (!options.preserveSelection) {
    setComponentSelection(null, { silent: true });
  }
}

function setOverlayHighlight(component, active) {
  if (!component?.overlay) return;
  if (component.kind === "vertex" && component.overlay.point) {
    component.overlay.point.pixelSize = active ? 15 : 11;
    component.overlay.point.color = (active ? Cesium.Color.ORANGE : Cesium.Color.fromCssColorString("#38bdf8")).withAlpha(
      active ? 1.0 : 0.95
    );
    component.overlay.point.outlineColor = active
      ? Cesium.Color.fromCssColorString("#1e293b")
      : Cesium.Color.fromCssColorString("#0f172a");
  } else if (component.kind === "edge" && component.overlay.polyline) {
    component.overlay.polyline.width = active ? 5 : 3;
    component.overlay.polyline.material = active ? Cesium.Color.ORANGE : Cesium.Color.fromCssColorString("#38bdf8");
  } else if (component.kind === "face" && component.overlay.polygon) {
    component.overlay.polygon.material = (active
      ? Cesium.Color.fromCssColorString("#f97316").withAlpha(0.28)
      : Cesium.Color.fromCssColorString("#3b82f6").withAlpha(0.18));
    component.overlay.polygon.outlineColor = active
      ? Cesium.Color.fromCssColorString("#f97316").withAlpha(0.85)
      : Cesium.Color.fromCssColorString("#2563eb").withAlpha(0.4);
  }
}

function setComponentSelection(componentMetadata, options = {}) {
  if (appState.selectedComponent) {
    setOverlayHighlight(appState.selectedComponent, false);
  }
  appState.selectedComponent = componentMetadata || null;
  if (componentMetadata) {
    setOverlayHighlight(componentMetadata, true);
  }
  if (!options.silent) {
    updateProportionalIndicator();
  } else {
    updateProportionalIndicator();
  }
}

function clearComponentSelection() {
  setComponentSelection(null, { silent: true });
}

function setObjectMode(mode) {
  if (!mode || (mode !== "object" && mode !== "edit")) return;
  if (appState.objectMode === mode) return;
  appState.objectMode = mode;
  if (objectModeButton) {
    objectModeButton.classList.toggle("active", mode === "object");
  }
  if (editModeButton) {
    editModeButton.classList.toggle("active", mode === "edit");
  }
  if (componentSwitch) {
    componentSwitch.classList.toggle("hidden", mode !== "edit");
  }
  if (proportionalControls) {
    proportionalControls.classList.toggle("hidden", mode !== "edit");
  }

  if (mode === "edit") {
    ensureProportionalIndicator();
    if (appState.selectedObject) {
      rebuildComponentOverlays(appState.selectedObject);
    }
  } else {
    if (appState.selectedObject) {
      destroyComponentOverlays(appState.selectedObject);
    }
    clearComponentSelection();
    updateProportionalIndicator();
  }

  updateModeIndicator();
}

function setComponentMode(mode) {
  if (!mode || !["vertex", "edge", "face"].includes(mode)) return;
  if (appState.componentMode === mode) return;
  appState.componentMode = mode;
  componentButtons.forEach((button) => {
    const isActive = button.dataset.component === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  if (appState.selectedComponent && appState.selectedComponent.kind !== mode) {
    clearComponentSelection();
  }
  if (appState.selectedObject && appState.objectMode === "edit") {
    rebuildComponentOverlays(appState.selectedObject, { preserveSelection: true });
  }
}

function toggleProportionalEditing(force) {
  const nextState = typeof force === "boolean" ? force : !appState.proportionalEditing;
  appState.proportionalEditing = nextState;
  if (proportionalToggle) {
    proportionalToggle.checked = nextState;
  }
  updateProportionalIndicator();
}

function updateProportionalRadius(value) {
  const clamped = Cesium.Math.clamp(Number(value) || appState.proportionalRadius, 1, 50);
  appState.proportionalRadius = clamped;
  if (proportionalRadiusInput) {
    proportionalRadiusInput.value = String(clamped);
  }
  if (proportionalRadiusValue) {
    proportionalRadiusValue.textContent = `${clamped}m`;
  }
  updateProportionalIndicator();
}

function adjustProportionalRadius(delta) {
  updateProportionalRadius(appState.proportionalRadius + delta);
}

function applyComponentTransform(session, totalDelta) {
  if (!session?.component) return;
  const { entity, initialDimensions, initialPosition, component } = session;
  const magnitude = computeSignsMagnitude(component.signs);
  const newDimensions = new Cesium.Cartesian3(
    initialDimensions.x,
    initialDimensions.y,
    initialDimensions.z
  );
  const positionOffset = new Cesium.Cartesian3();
  const axes = getEntityAxes(entity);
  const axisKeys = ["x", "y", "z"];

  axisKeys.forEach((axisKey) => {
    const sign = component.signs[axisKey] || 0;
    if (!sign) return;
    const contribution = Math.abs(sign) / magnitude;
    const axisDelta = totalDelta * contribution;
    const baseValue = initialDimensions[axisKey];
    let candidate = baseValue + axisDelta;
    if (candidate < 0.2) candidate = 0.2;
    const appliedDelta = candidate - baseValue;
    newDimensions[axisKey] = candidate;
    const axisVector = axes[axisKey];
    const offsetVector = Cesium.Cartesian3.multiplyByScalar(
      axisVector,
      (appliedDelta / 2) * Math.sign(sign),
      new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.add(positionOffset, offsetVector, positionOffset);
  });

  if (appState.proportionalEditing) {
    const geometry = computeCubeGeometry(entity);
    const center = session.componentCenter || component.center;
    const vertices = geometry.vertices.map((vertex) => {
      const distance = Cesium.Cartesian3.distance(vertex.position, center);
      return {
        weight: computeProportionalWeight(distance, appState.proportionalRadius),
        signs: vertex.signs,
      };
    });
    const totalWeight = vertices.reduce((sum, vertex) => sum + vertex.weight, 0);
    axisKeys.forEach((axisKey) => {
      if (component.signs[axisKey]) return;
      if (totalWeight <= Cesium.Math.EPSILON7) return;
      const axisWeight = vertices.reduce((sum, vertex) => {
        const contribution = Math.abs(vertex.signs[axisKey] || 0);
        if (contribution === 0) return sum;
        return sum + vertex.weight * contribution;
      }, 0);
      if (axisWeight <= Cesium.Math.EPSILON7) return;
      const ratio = Cesium.Math.clamp(axisWeight / totalWeight, 0, 1);
      const baseValue = initialDimensions[axisKey];
      let candidate = baseValue + totalDelta * ratio * 0.5;
      if (candidate < 0.2) candidate = 0.2;
      newDimensions[axisKey] = candidate;
    });
  }

  entity.box.dimensions = newDimensions;
  if (entity.cubeMetadata) {
    entity.cubeMetadata.dimensions = Cesium.Cartesian3.clone(newDimensions, new Cesium.Cartesian3());
  }
  const newPosition = Cesium.Cartesian3.add(initialPosition, positionOffset, new Cesium.Cartesian3());
  entity.position = new Cesium.ConstantPositionProperty(newPosition);
  updatePanels(entity);
  updateGizmoPosition();
  rebuildComponentOverlays(entity, { preserveSelection: true });
  updateProportionalIndicator();
}

function setSelectedObject(entity) {
  if (appState.selectedObject === entity) {
    updatePanels(entity);
    if (entity && appState.objectMode === "edit") {
      rebuildComponentOverlays(entity, { preserveSelection: true });
      updateProportionalIndicator();
    }

    return;
  }

  if (Cesium.defined(appState.selectedObject)) {
    destroyComponentOverlays(appState.selectedObject);
    restoreDefaultMaterial(appState.selectedObject);
  }
  clearComponentSelection();


  appState.selectedObject = entity;

  if (Cesium.defined(entity)) {
    highlightEntity(entity);
    updatePanels(entity);
    ensureGizmo(entity);
    refreshGizmoHighlight();
    parameterPanel.classList.remove("hidden");
    if (appState.objectMode === "edit") {
      rebuildComponentOverlays(entity);
    }
    updateProportionalIndicator();

    emitStateEvent("selection", { entity, selected: true });
  } else {
    hidePanels();
    removeGizmo();
    updatePropertyPanel(null);
    updateProportionalIndicator();

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
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());
  const dimensions = entity.box.dimensions.getValue(julianNow);
  const orientation = Cesium.Quaternion.clone(getEntityOrientation(entity, julianNow));

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
  endViewRingSession({ cancelled: true });
  gizmoEntities.forEach((e) => viewer.entities.remove(e));
  gizmoEntities = [];
  appState.gizmo = null;

  // 清理轴端点缓存
  axisEndpointsCache.clear();
}

function computeAxisEndpoints(entity, axis, length = 20.0, space = "local") {
  if (!entity) {
    return { start: Cesium.Cartesian3.ZERO, end: Cesium.Cartesian3.ZERO };
  }

  // 验证长度参数
  if (!isFinite(length) || length <= 0 || length > 10000) {
    length = 20.0;
  }

  const julianNow = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());

  if (!position || !Cesium.defined(position.x) || !Cesium.defined(position.y) || !Cesium.defined(position.z) ||
      !isFinite(position.x) || !isFinite(position.y) || !isFinite(position.z)) {
    return { start: Cesium.Cartesian3.ZERO, end: Cesium.Cartesian3.ZERO };
  }

  const axisVector = getAxisVector(axis, space, entity);
  if (
    !axisVector ||
    !Cesium.defined(axisVector.x) ||
    !Cesium.defined(axisVector.y) ||
    !Cesium.defined(axisVector.z) ||
    !isFinite(axisVector.x) || !isFinite(axisVector.y) || !isFinite(axisVector.z)
  ) {
    return { start: position, end: position };
  }

  // 验证轴向量是否为零向量
  const magnitude = Math.sqrt(axisVector.x * axisVector.x + axisVector.y * axisVector.y + axisVector.z * axisVector.z);
  if (magnitude === 0) {
    return { start: position, end: position };
  }

  const normalized = Cesium.Cartesian3.normalize(axisVector, new Cesium.Cartesian3());
  
  // 验证归一化结果
  if (!normalized || !Cesium.defined(normalized.x) || !Cesium.defined(normalized.y) || !Cesium.defined(normalized.z) ||
      !isFinite(normalized.x) || !isFinite(normalized.y) || !isFinite(normalized.z)) {
    return { start: position, end: position };
  }

  const scaled = Cesium.Cartesian3.multiplyByScalar(normalized, length, new Cesium.Cartesian3());
  
  // 验证缩放结果
  if (!scaled || !Cesium.defined(scaled.x) || !Cesium.defined(scaled.y) || !Cesium.defined(scaled.z) ||
      !isFinite(scaled.x) || !isFinite(scaled.y) || !isFinite(scaled.z)) {
    return { start: position, end: position };
  }

  const endPoint = Cesium.Cartesian3.add(position, scaled, new Cesium.Cartesian3());
  
  // 验证最终结果
  if (!endPoint || !Cesium.defined(endPoint.x) || !Cesium.defined(endPoint.y) || !Cesium.defined(endPoint.z) ||
      !isFinite(endPoint.x) || !isFinite(endPoint.y) || !isFinite(endPoint.z)) {
    return { start: position, end: position };
  }

  return { start: position, end: endPoint };
}

// 缓存轴端点计算结果已在上面声明

// 验证缓存数据的有效性
function isValidCachedData(data) {
  if (!data || !data.entity || !data.points) return false;
  if (!data.points.start || !data.points.end) return false;
  if (!Cesium.defined(data.points.start.x) || !Cesium.defined(data.points.start.y) || !Cesium.defined(data.points.start.z)) return false;
  if (!Cesium.defined(data.points.end.x) || !Cesium.defined(data.points.end.y) || !Cesium.defined(data.points.end.z)) return false;
  return true;
}

function getCachedAxisEndpoints(entity, axis, length = 20.0, space = "local") {
  const cacheKey = `${entity.id}_${axis}_${space}_${length.toFixed(2)}`;
  if (axisEndpointsCache.has(cacheKey)) {
    const cached = axisEndpointsCache.get(cacheKey);
    if (isValidCachedData(cached) && cached.entity === entity) {
      return cached.points;
    }
    axisEndpointsCache.delete(cacheKey);
  }
  const points = computeAxisEndpoints(entity, axis, length, space);
  axisEndpointsCache.set(cacheKey, { entity, points });

  // 清除同一实体/轴的旧缓存，避免无限增长
  for (const key of axisEndpointsCache.keys()) {
    if (key.startsWith(`${entity.id}_${axis}_${space}_`) && key !== cacheKey) {
      axisEndpointsCache.delete(key);
    }
  }

  return points;
}

function computeGizmoAxisLength(entity) {
  const julianNow = Cesium.JulianDate.now();
  const dimensions = getEntityDimensions(entity, julianNow);
  if (!dimensions) {
    return 20.0;
  }
  const maxDim = Math.max(dimensions.x, dimensions.y, dimensions.z);
  return Math.max(12.0, maxDim * 1.3);
}

function computePlaneHandleHierarchy(entity, planeKey, sizeMultiplier = 1.0) {
  if (!entity) {
    return new Cesium.PolygonHierarchy([]);
  }
  const julianNow = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());
  const axes = getPlaneAxes(planeKey);
  if (axes.length !== 2) {
    return new Cesium.PolygonHierarchy([]);
  }

  const length = computeGizmoAxisLength(entity) * 0.65 * sizeMultiplier;
  const offsetFraction = 0.35;
  const axisA = Cesium.Cartesian3.multiplyByScalar(
    getAxisVector(axes[0], "local", entity),
    length,
    new Cesium.Cartesian3()
  );
  const axisB = Cesium.Cartesian3.multiplyByScalar(
    getAxisVector(axes[1], "local", entity),
    length,
    new Cesium.Cartesian3()
  );

  const originOffset = Cesium.Cartesian3.add(
    Cesium.Cartesian3.multiplyByScalar(axisA, offsetFraction, new Cesium.Cartesian3()),
    Cesium.Cartesian3.multiplyByScalar(axisB, offsetFraction, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );

  const origin = Cesium.Cartesian3.add(position, originOffset, new Cesium.Cartesian3());
  const corner1 = Cesium.Cartesian3.clone(origin, new Cesium.Cartesian3());
  const corner2 = Cesium.Cartesian3.add(origin, axisA, new Cesium.Cartesian3());
  const corner3 = Cesium.Cartesian3.add(origin, Cesium.Cartesian3.add(axisA, axisB, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const corner4 = Cesium.Cartesian3.add(origin, axisB, new Cesium.Cartesian3());

  return new Cesium.PolygonHierarchy([corner1, corner2, corner3, corner4]);
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
  createUniversalGizmo(entity);
  refreshGizmoHighlight();
}

function updateGizmoPosition() {
  if (!appState.selectedObject) {
    removeGizmo();
    return;
  }
  ensureGizmo(appState.selectedObject);
}

function refreshGizmoHighlight() {
  if (!appState.gizmo) return;

  const session = appState.transformSession;
  const sessionAxis = session && session.activeAxis ? session.activeAxis : null;
  const axisMode = sessionAxis && sessionAxis !== "none" ? sessionAxis : appState.axisMode;
  const activeMode = session ? session.mode : appState.mode;

  const isPlaneActive = isPlaneConstraint(axisMode);
  const planeAxes = isPlaneActive ? getPlaneAxes(axisMode) : [];
  const highlightedAxes = new Set();
  planeAxes.forEach((axis) => highlightedAxes.add(axis));
  if (axisMode && axisMode !== "none" && !isPlaneActive) {
    highlightedAxes.add(axisMode);
  }

  Object.entries(appState.gizmo.axes).forEach(([axis, handleSet]) => {
    const translateHighlight = highlightedAxes.has(axis) && (activeMode === "translate" || activeMode === "view" || (session && session.mode === "translate"));
    const scaleHighlight = highlightedAxes.has(axis) && (activeMode === "scale" || activeMode === "view" || (session && session.mode === "scale"));
    const rotateHighlight = !isPlaneActive && axisMode === axis && (activeMode === "rotate" || activeMode === "view" || (session && session.mode === "rotate"));

    if (handleSet.translate?.graphics) {
      handleSet.translate.graphics.width = translateHighlight ? 6 : 4;
      handleSet.translate.graphics.material = handleSet.translate.color.withAlpha(translateHighlight ? 1.0 : 0.55);
    }

    if (handleSet.rotate?.graphics) {
      handleSet.rotate.graphics.width = rotateHighlight ? 5 : 3;
      handleSet.rotate.graphics.material = handleSet.rotate.color.withAlpha(rotateHighlight ? 1.0 : 0.45);
    }

    if (handleSet.scale?.graphics) {
      handleSet.scale.graphics.pixelSize = scaleHighlight ? 16 : 12;
      handleSet.scale.graphics.color = handleSet.scale.color.withAlpha(scaleHighlight ? 1.0 : 0.85);
      handleSet.scale.graphics.outlineColor = Cesium.Color.WHITE.withAlpha(scaleHighlight ? 1.0 : 0.7);
    }
  });

  if (appState.gizmo.planes) {
    Object.entries(appState.gizmo.planes).forEach(([planeKey, planeHandle]) => {
      const highlight = isPlaneActive && planeKey === axisMode && (activeMode === "translate" || activeMode === "view" || (session && session.mode === "translate"));
      planeHandle.graphics.material = planeHandle.color.withAlpha(highlight ? 0.35 : 0.18);
      planeHandle.graphics.outlineColor = planeHandle.color.withAlpha(highlight ? 0.85 : 0.55);
    });
  }

  if (appState.gizmo.center?.graphics) {
    const centerActive =
      (session && session.mode === "scale" && (!session.activeAxis || session.activeAxis === "none")) ||
      (!session && activeMode === "scale" && (!axisMode || axisMode === "none"));
    const centerPoint = appState.gizmo.center.graphics;
    centerPoint.pixelSize = centerActive ? 16 : 12;
    centerPoint.color = appState.gizmo.center.color.withAlpha(centerActive ? 1.0 : 0.9);
    centerPoint.outlineColor = Cesium.Color.WHITE.withAlpha(centerActive ? 1.0 : 0.75);
  }
}

function createUniversalGizmo(entity) {
  const axisColors = {
    x: Cesium.Color.fromCssColorString("#ff6b6b"),
    y: Cesium.Color.fromCssColorString("#51ff8f"),
    z: Cesium.Color.fromCssColorString("#64b5ff"),
  };

  const rotationColors = {
    x: Cesium.Color.fromCssColorString("#ff8c69"),
    y: Cesium.Color.fromCssColorString("#7dff7a"),
    z: Cesium.Color.fromCssColorString("#84c7ff"),
  };

  const planeColors = {
    xy: Cesium.Color.fromCssColorString("#ffd166"),
    yz: Cesium.Color.fromCssColorString("#06d6a0"),
    xz: Cesium.Color.fromCssColorString("#118ab2"),
  };

  const axes = { x: {}, y: {}, z: {} };
  const planes = {};

  const centerColor = Cesium.Color.fromCssColorString("#ff9f1c");

  const baseRadius = computeRotationRadius(entity);

  let viewRingEntity = null;
  if (appState.mode === "view") {
    const ringRadius = computeRotationRadius(entity) * 1.15;
    viewRingEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => computeViewAlignedCircle(entity, ringRadius),
          false
        ),
        material: Cesium.Color.WHITE.withAlpha(0.45),
        width: 2.5,
        arcType: Cesium.ArcType.NONE,
      },
    });
    viewRingEntity.gizmoMetadata = { type: "view-ring", mode: "view", target: entity };
    gizmoEntities.push(viewRingEntity);
  }

  ["x", "y", "z"].forEach((axis) => {
    const color = axisColors[axis];
    const rotationColor = rotationColors[axis];

    // 使用缓存的轴端点计算
    const cacheKey = `${entity.id}_${axis}`;
    let cachedEndpoints = null;
    

    const polyline = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          try {
            const length = computeGizmoAxisLength(entity);
            const points = getCachedAxisEndpoints(entity, axis, length, "local");
            return [points.start, points.end];
          } catch (error) {
            console.warn(`Gizmo axis 计算错误 (${axis}):`, error);
            return [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO];
          }
        }, false),
        material: color.withAlpha(0.65),
        width: 4,
        arcType: Cesium.ArcType.NONE,
      },
    });
    polyline.gizmoMetadata = {
      mode: "translate",
      axis,
      axisSpace: "local",
      kind: "axis",
    };

    const label = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        try {
          const length = computeGizmoAxisLength(entity);
          const points = getCachedAxisEndpoints(entity, axis, length, "local");
          return points.end;
        } catch (error) {
          console.warn(`Gizmo label 计算错误 (${axis}):`, error);
          return Cesium.Cartesian3.ZERO;
        }
      }, false),
      label: {
        text: axis.toUpperCase(),
        font: "16px Inter",
        fillColor: color.withAlpha(0.95),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.45),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 1000000.0),
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
    });

    const scaleHandle = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        try {
          const length = computeGizmoAxisLength(entity);
          const points = getCachedAxisEndpoints(entity, axis, length, "local");
          return points.end;
        } catch (error) {
          console.warn(`Gizmo scale handle 计算错误 (${axis}):`, error);
          return Cesium.Cartesian3.ZERO;
        }
      }, false),
      point: {
        pixelSize: 12,
        color: color.withAlpha(0.9),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    scaleHandle.gizmoMetadata = {
      mode: "scale",
      axis,
      axisSpace: "local",
      kind: "scale",
    };

    const rotationArc = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => computeAxisArc(entity, axis, baseRadius), false),
        material: rotationColor.withAlpha(0.85),
        width: 3,
        arcType: Cesium.ArcType.NONE,
      },
    });
    rotationArc.gizmoMetadata = {
      mode: "rotate",
      axis,
      axisSpace: "local",
      kind: "rotate",
    };

    gizmoEntities.push(polyline, label, scaleHandle, rotationArc);

    axes[axis] = {
      translate: { entity: polyline, graphics: polyline.polyline, color },
      rotate: { entity: rotationArc, graphics: rotationArc.polyline, color: rotationColor },
      scale: { entity: scaleHandle, graphics: scaleHandle.point, color },
      label,
    };
  });

  appState.gizmo = { entity, axes, type: "translate", viewRing: viewRingEntity };

}

function computeRotationRadius(entity) {
  const julianNow = Cesium.JulianDate.now();
  const dimensions = getEntityDimensions(entity, julianNow);
  if (!dimensions) return 10.0;
  const maxDim = Math.max(dimensions.x, dimensions.y, dimensions.z);
  return Math.max(10.0, maxDim * 0.75);
}

function computeViewAlignedCircle(entity, radius, segments = 64) {
  const julianNow = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());
  const right = Cesium.Cartesian3.normalize(viewer.camera.right, new Cesium.Cartesian3());
  const up = Cesium.Cartesian3.normalize(viewer.camera.up, new Cesium.Cartesian3());
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const direction = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(right, Math.cos(angle), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(up, Math.sin(angle), new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const scaled = Cesium.Cartesian3.multiplyByScalar(direction, radius, new Cesium.Cartesian3());
    points.push(Cesium.Cartesian3.add(position, scaled, new Cesium.Cartesian3()));
  }
  return points;
}

function computeAxisArc(entity, axis, radius, segments = 48) {
  const julianNow = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());
  const axisVector = Cesium.Cartesian3.normalize(
    getAxisVector(axis, "local", entity),
    new Cesium.Cartesian3()
  );
  let reference = Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
  if (Math.abs(Cesium.Cartesian3.dot(axisVector, reference)) > 0.9) {
    reference = Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3());
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
  const start = -Math.PI / 1.5;
  const end = Math.PI / 1.5;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = start + ((end - start) * i) / segments;
    const direction = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(perp1, Math.cos(t), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(perp2, Math.sin(t), new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const scaled = Cesium.Cartesian3.multiplyByScalar(direction, radius, new Cesium.Cartesian3());
    points.push(Cesium.Cartesian3.add(position, scaled, new Cesium.Cartesian3()));
  }
  return points;
}

function updateRotationBasis(session) {
  if (!session) return;
  const { entity } = session;
  const julianNow = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julianNow, new Cesium.Cartesian3());

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

if (objectModeButton && editModeButton) {
  objectModeButton.addEventListener("click", () => setObjectMode("object"));
  editModeButton.addEventListener("click", () => setObjectMode("edit"));
}

if (componentButtons.length) {
  componentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.component;
      setComponentMode(mode);
    });
  });
}

if (proportionalToggle) {
  proportionalToggle.addEventListener("change", (event) => {
    toggleProportionalEditing(event.target.checked);
  });
}

if (proportionalRadiusInput) {
  proportionalRadiusInput.addEventListener("input", (event) => {
    updateProportionalRadius(event.target.value);
  });
}

if (modifierAddButton && modifierTemplate) {
  modifierAddButton.addEventListener("click", () => {
    if (!appState.selectedObject) return;
    const type = modifierTemplate.value;
    const config = MODIFIER_LIBRARY[type];
    if (!config) return;
    const entity = appState.selectedObject;
    if (!entity.cubeMetadata) return;
    if (!Array.isArray(entity.cubeMetadata.modifiers)) {
      entity.cubeMetadata.modifiers = [];
    }
    entity.cubeMetadata.modifiers.push({
      id: `modifier-${++appState.modifierCounter}`,
      type,
      enabled: true,
      params: { ...config.params },
    });
    renderModifierList(entity);
    applyModifiers(entity);
    applyMaterial(entity, { selected: true, force: true });
  });
}

setObjectMode(appState.objectMode);
setComponentMode(appState.componentMode);
updateProportionalRadius(appState.proportionalRadius);
toggleProportionalEditing(appState.proportionalEditing);


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
  
  // 检查是否点击了 Gizmo
  if (picked?.id?.gizmoMetadata) {
    const metadata = picked.id.gizmoMetadata;
    if (metadata.mode && metadata.axis) {
      // 设置轴向约束
      appState.axisMode = metadata.axis;
      appState.axisSpace = metadata.axisSpace || "local";
      updateAxisIndicator();
      
      // 开始相应的变换模式
      beginTransform(metadata.mode, {
        axis: metadata.axis,
        axisSpace: metadata.axisSpace || "local",
        fromGizmo: true
      });
      return;
    }
  }
  
  if (appState.objectMode === "edit" && picked?.id?.componentMetadata) {
    const component = picked.id.componentMetadata;
    if (component.owner && !isSelectionAllowed(component.owner)) {
      showSelectionFilteredHint();
      return;
    }
    if (component.owner && component.owner !== appState.selectedObject) {
      setSelectedObject(component.owner);
    }
    setComponentSelection(component);
    return;
  }

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
  if (!movement?.position) return;
  const picked = viewer.scene.pick(movement.position);
  const pickedEntity = picked?.id;
  const metadata = getPickedMetadata(pickedEntity);
  if (metadata && metadata.mode === "view") {
    beginViewRingSession(pickedEntity, movement.position);
  }
}, Cesium.ScreenSpaceEventType.LEFT_DOWN);

handler.setInputAction((movement) => {
  if (appState.viewRingSession) {
    updateViewRingSession(movement);
    return;
  }
  if (appState.cameraNavigationActive) return;
  if (appState.mode === "translate") {
    performTranslate(movement);
  } else if (appState.mode === "rotate") {
    performRotate(movement);
  } else if (appState.mode === "scale") {
    performScale(movement);

  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

handler.setInputAction(() => {
  if (!appState.viewRingSession) return;
  const ended = endViewRingSession();
  if (ended) {
    appState.skipNextClick = true;
  }
}, Cesium.ScreenSpaceEventType.LEFT_UP);

handler.setInputAction((click) => {
  if (appState.transformSession) {
    return;
  }
  if (appState.cameraNavigationActive || appState.skipNextClick) {
    appState.skipNextClick = false;
    return;
  }
  handleSelection(click);
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

handler.setInputAction(() => {
  if (appState.mode === "translate" || appState.mode === "rotate" || appState.mode === "scale") {
    commitTransform();
  }
}, Cesium.ScreenSpaceEventType.LEFT_UP);

handler.setInputAction((click) => {
  if (appState.mode === "translate" || appState.mode === "rotate" || appState.mode === "scale") {
    cancelTransform();
    return;
  }
  if (appState.selectedObject) {
    setSelectedObject(null);
  }
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

function beginTransform(mode, options = {}) {
  if (!appState.selectedObject) return;
  const entity = appState.selectedObject;
  const julianNow = Cesium.JulianDate.now();
  const dimensionValue = getEntityDimensions(entity, julianNow) || defaultCubeConfig.dimensions;
  const initialDimensions = Cesium.Cartesian3.clone(dimensionValue, new Cesium.Cartesian3());

  let activeAxis = options.axis ?? appState.axisMode;
  if (mode !== "translate" && isPlaneConstraint(activeAxis)) {
    activeAxis = "none";
  }

  const axisSpace = options.axisSpace || appState.axisSpace;

  appState.transformSession = {
    mode,
    entity,
    initialPosition: getEntityPosition(entity, julianNow, new Cesium.Cartesian3()),
    initialOrientation: Cesium.Quaternion.clone(getEntityOrientation(entity, julianNow)),
    initialDimensions,
    activeAxis,

    axisSpace,
    isShift: false,
    isCtrl: false,
    lastDirection: null,
    numericApplied: false,
    lockProportion: Boolean(options.lockProportion),
    fromGizmo: Boolean(options.fromGizmo),
  };

  if (appState.objectMode === "edit" && appState.selectedComponent) {
    const component = appState.selectedComponent;
    appState.transformSession.component = {
      kind: component.kind,
      index: component.index,
      signs: { ...component.signs },
      normal: computeWorldDirectionFromSigns(component.signs, entity),
    };
    appState.transformSession.componentCenter = Cesium.Cartesian3.clone(
      component.center,
      new Cesium.Cartesian3()
    );
    appState.transformSession.componentDelta = 0;
    if (component.kind === "face") {
      appState.axisMode = component.signs.x
        ? "x"
        : component.signs.y
        ? "y"
        : "z";
      appState.axisSpace = "local";
      updateAxisIndicator();
    } else {
      appState.axisMode = "none";
      appState.axisSpace = "local";
      updateAxisIndicator();
    }
  }


  const baseColor = entity.box.material.getValue(julianNow);
  // 确保 baseColor 是 Cesium Color 对象
  const color = baseColor instanceof Cesium.Color ? baseColor : Cesium.Color.WHITE;
  entity.box.material = new Cesium.ColorMaterialProperty(color.withAlpha(0.4));
  setMode(mode);
  updateGizmoPosition();
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
  if (appState.objectMode === "edit") {
    rebuildComponentOverlays(entity, { preserveSelection: true });
    updateProportionalIndicator();
  }

  emitStateEvent("transform", { phase: "commit", entity });
}

function cancelTransform() {
  if (!appState.transformSession) return;
  const { entity, initialPosition, initialOrientation, initialDimensions } = appState.transformSession;
  entity.position = new Cesium.ConstantPositionProperty(initialPosition);
  entity.orientation = new Cesium.ConstantProperty(initialOrientation);
  entity.box.dimensions = new Cesium.Cartesian3(initialDimensions.x, initialDimensions.y, initialDimensions.z);
  if (entity.cubeMetadata) {
    entity.cubeMetadata.dimensions = new Cesium.Cartesian3(
      initialDimensions.x,
      initialDimensions.y,
      initialDimensions.z
    );
  }

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
  if (appState.objectMode === "edit") {
    rebuildComponentOverlays(entity);
    updateProportionalIndicator();
  }

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

function computeDragPlane(entity, axis, axisSpace = appState.axisSpace) {
  const julian = Cesium.JulianDate.now();
  const position = getEntityPosition(entity, julian, new Cesium.Cartesian3());

  if (!axis || axis === "none") {
    const normal = getSurfaceNormal(position);
    return Cesium.Plane.fromPointNormal(position, normal);
  }
  if (isPlaneConstraint(axis)) {
    const normalAxis = getPlaneNormalAxis(axis);
    const normalVector = getAxisVector(normalAxis, axisSpace, entity);
    if (Cesium.Cartesian3.magnitude(normalVector) < Cesium.Math.EPSILON7) {
      const fallback = getSurfaceNormal(position);
      return Cesium.Plane.fromPointNormal(position, fallback);
    }
    return Cesium.Plane.fromPointNormal(position, normalVector);
  }
  const axisVector = getAxisVector(axis, axisSpace, entity);

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

function performTranslate(movement) {
  const session = appState.transformSession;
  if (!session) return;
  if (session.component) {
    const delta = computeCursorDelta(movement.startPosition, movement.endPosition);
    const scalar = delta.y * -0.1 + delta.x * 0.05;
    let amount = scalar;
    if (session.isShift) {
      amount *= SHIFT_SLOW_RATIO;
    }
    if (session.isCtrl) {
      amount = snapValue(amount, GRID_STEP * 0.5);
    }
    session.componentDelta = (session.componentDelta || 0) + amount;
    session.lastDirection = session.component.normal;
    applyComponentTransform(session, session.componentDelta);
    return;
  }
  const entity = session.entity;
  const plane = computeDragPlane(entity, session.activeAxis, session.axisSpace);
  const ray = viewer.camera.getPickRay(movement.endPosition);

  if (!Cesium.defined(ray)) return;
  const t = Cesium.IntersectionTests.rayPlane(ray, plane);
  if (!Cesium.defined(t)) return;
  const intersection = Cesium.Ray.getPoint(ray, t, new Cesium.Cartesian3());
  const delta = Cesium.Cartesian3.subtract(intersection, session.initialPosition, new Cesium.Cartesian3());

  let direction = delta;
  if (session.activeAxis && session.activeAxis !== "none") {
    if (isPlaneConstraint(session.activeAxis)) {
      const normalAxis = getPlaneNormalAxis(session.activeAxis);
      const normalVector = getAxisVector(normalAxis, session.axisSpace, entity);
      const projection = Cesium.Cartesian3.multiplyByScalar(
        normalVector,
        Cesium.Cartesian3.dot(delta, normalVector),
        new Cesium.Cartesian3()
      );
      direction = Cesium.Cartesian3.subtract(delta, projection, new Cesium.Cartesian3());
    } else {
      const axisVector = getAxisVector(session.activeAxis, session.axisSpace, entity);
      const projected = Cesium.Cartesian3.multiplyByScalar(
        axisVector,
        Cesium.Cartesian3.dot(delta, axisVector),
        new Cesium.Cartesian3()
      );
      direction = projected;
    }

  }

  if (session.isShift) {
    direction = Cesium.Cartesian3.multiplyByScalar(direction, SHIFT_SLOW_RATIO, new Cesium.Cartesian3());
  }

  if (session.isCtrl) {
    direction = snapVector(direction, GRID_STEP);
  }

  if (Cesium.Cartesian3.magnitude(direction) > Cesium.Math.EPSILON7) {
    session.lastDirection = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  }

  const newPosition = Cesium.Cartesian3.add(session.initialPosition, direction, new Cesium.Cartesian3());
  entity.position = new Cesium.ConstantPositionProperty(newPosition);
  updatePanels(entity);
  updateGizmoPosition();
}

function performRotate(movement) {

  const session = appState.transformSession;
  if (!session) return;
  const entity = session.entity;
  const axisKey = session.activeAxis && session.activeAxis !== "none" ? session.activeAxis : "z";
  const axisVector = getAxisVector(axisKey, session.axisSpace, entity);
  const delta = computeCursorDelta(movement.startPosition, movement.endPosition);

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

function performScale(movement) {
  const session = appState.transformSession;
  if (!session) return;
  if (session.component) {
    const delta = computeCursorDelta(movement.startPosition, movement.endPosition);
    let amount = delta.y * -0.12;
    if (session.isShift) {
      amount *= SHIFT_SLOW_RATIO;
    }
    if (session.isCtrl) {
      amount = snapValue(amount, GRID_STEP * 0.5);
    }
    session.componentDelta = (session.componentDelta || 0) + amount;
    session.lastDirection = session.component.normal;
    applyComponentTransform(session, session.componentDelta);
    return;
  }
  const entity = session.entity;
  const delta = computeCursorDelta(movement.startPosition, movement.endPosition);

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
  if (session.component && (session.mode === "translate" || session.mode === "scale")) {
    session.componentDelta = value;
    session.lastDirection = session.component.normal;
    applyComponentTransform(session, session.componentDelta);
    session.numericApplied = true;
    resetNumericBuffer();
    return;
  }
  if (session.mode === "translate") {
    let axisVector;
    if (session.activeAxis && session.activeAxis !== "none") {
      if (isPlaneConstraint(session.activeAxis)) {
        axisVector = session.lastDirection;
        if (!axisVector) {
          resetNumericBuffer();
          return;
        }
      } else {
        axisVector = getAxisVector(session.activeAxis, session.axisSpace, entity);
      }

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

  if (key === "Tab") {
    event.preventDefault();
    const nextMode = appState.objectMode === "object" ? "edit" : "object";
    setObjectMode(nextMode);
    return;
  }


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

  if (appState.objectMode === "edit" && ["1", "2", "3"].includes(key)) {
    event.preventDefault();
    const mapping = { "1": "vertex", "2": "edge", "3": "face" };
    setComponentMode(mapping[key]);
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
    const baseAxis = key.toLowerCase();
    const usingPlane = event.shiftKey && !event.ctrlKey && !event.altKey;
    const targetMode = usingPlane ? PLANE_AXIS_MAP[baseAxis] : baseAxis;
    if (appState.axisMode === targetMode) {

      appState.axisSpace = appState.axisSpace === "global" ? "local" : "global";
    } else {
      appState.axisSpace = "global";
    }
    appState.axisMode = targetMode;
    updateAxisIndicator();
    refreshGizmoHighlight();
    if (appState.transformSession) {
      let appliedAxis = targetMode;
      if (isPlaneConstraint(appliedAxis) && appState.transformSession.mode !== "translate") {
        appliedAxis = "none";
      }
      appState.transformSession.activeAxis = appliedAxis;

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

  if ((key === "o" || key === "O") && appState.objectMode === "edit") {
    event.preventDefault();
    toggleProportionalEditing();
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

const canvas = viewer.scene.canvas;
canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 1 || (event.button === 0 && event.altKey)) {
    appState.cameraNavigationActive = true;
  }
});
canvas.addEventListener("pointerup", () => {
  appState.cameraNavigationActive = false;
  if (appState.viewRingSession) {
    const ended = endViewRingSession();
    if (ended) {
      appState.skipNextClick = true;
    }
  }
});
canvas.addEventListener("pointerleave", () => {
  appState.cameraNavigationActive = false;
  if (appState.viewRingSession) {
    endViewRingSession({ cancelled: true });
  }
});
canvas.addEventListener("pointercancel", () => {
  appState.cameraNavigationActive = false;
  if (appState.viewRingSession) {
    endViewRingSession({ cancelled: true });
  }
});
canvas.addEventListener(
  "wheel",
  (event) => {
    if (appState.objectMode === "edit" && appState.proportionalEditing && appState.selectedComponent) {
      const step = event.deltaY > 0 ? -1 : 1;
      adjustProportionalRadius(step);
      event.preventDefault();
    }
  },
  { passive: false }
);


// 移除不必要的每帧更新 - updateGizmoPosition 只在需要时调用

// 性能监控工具
const performanceMonitor = {
  frameCount: 0,
  lastTime: performance.now(),
  frameTimes: [],
  maxFrameTime: 0,
  averageFrameTime: 0,
  
  start() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.frameTimes = [];
    this.maxFrameTime = 0;
    this.averageFrameTime = 0;
  },
  
  update() {
    const currentTime = performance.now();
    const frameTime = currentTime - this.lastTime;
    
    this.frameCount++;
    this.frameTimes.push(frameTime);
    
    if (frameTime > this.maxFrameTime) {
      this.maxFrameTime = frameTime;
    }
    
    // 保持最近100帧的记录
    if (this.frameTimes.length > 100) {
      this.frameTimes.shift();
    }
    
    this.averageFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.lastTime = currentTime;
    
    // 如果帧时间过长，输出警告
    // if (frameTime > 16.67) { // 超过60fps的阈值
    //   console.warn(`[性能警告] 帧时间过长: ${frameTime.toFixed(2)}ms (目标: 16.67ms)`);
    // }
  },
  
  getStats() {
    return {
      frameCount: this.frameCount,
      averageFrameTime: this.averageFrameTime.toFixed(2),
      maxFrameTime: this.maxFrameTime.toFixed(2),
      currentFPS: (1000 / this.averageFrameTime).toFixed(1),
      cacheStats: {
        geometryCache: geometryCache.size,
        materialCache: materialCache.size,
        axisEndpointsCache: axisEndpointsCache.size
      }
    };
  },
  
  logStats() {
    const stats = this.getStats();
    console.log('[性能统计]', stats);
  }
};

// 启动性能监控
performanceMonitor.start();

// 每帧更新性能监控
viewer.scene.postRender.addEventListener(() => {
  performanceMonitor.update();
});

// 添加全局性能监控函数
window.getPerformanceStats = () => performanceMonitor.getStats();
window.logPerformanceStats = () => performanceMonitor.logStats();

// 每5秒输出一次性能统计（仅在开发模式下）
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  performanceStatsInterval = setInterval(() => {
    performanceMonitor.logStats();
  }, 5000);
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', () => {
  if (containerSizeInterval) {
    clearInterval(containerSizeInterval);
  }
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
  }
  if (performanceStatsInterval) {
    clearInterval(performanceStatsInterval);
  }
});

updateModeIndicator();
updateAxisIndicator();

export { onStateChange, offStateChange, removeObjectById };
