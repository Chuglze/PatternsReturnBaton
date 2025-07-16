// [최신 CDN 적용]
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js';
import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm';

// --- 클래스 정의 (수정 없음) ---
class Renderer {
  #vertexSrc = `#version 300 es\nprecision highp float;\nin vec4 position;\nvoid main(){gl_Position=position;}`;
  #fragmtSrc = `#version 300 es\nprecision highp float;\nout vec4 O;\nuniform float time;\nuniform vec2 resolution;\nvoid main() {\n\tvec2 uv=gl_FragCoord.xy/resolution;\n\tO=vec4(uv,sin(time)*.5+.5,1);\n}`;
  #vertices = [-1, 1, -1, -1, 1, 1, 1, -1];
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true });
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.shaderSource = this.#fragmtSrc;
    this.mouseMove = [0, 0];
    this.zoom = 16.0;
    this.shapeParams = new THREE.Vector3();
  }
  updateShader(source) { this.shaderSource = source; this.setup(); this.init(); }
  updateMove(deltas) { this.mouseMove = deltas; }
  updateScale(scale) { this.gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
  updateZoom(delta) { this.zoom += delta * 0.02; this.zoom = Math.max(5.0, Math.min(40.0, this.zoom)); }
  updateShapeParams(params) { this.shapeParams.copy(params); }
  compile(shader, source) {
    const gl = this.gl;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      console.error('Shader compile error:', error, '\nSource:\n', source);
      this.canvas.dispatchEvent(new CustomEvent('shader-error', { detail: error }));
    }
  }
  test(source) { let result = null; const gl = this.gl; const shader = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { result = gl.getShaderInfoLog(shader); } gl.deleteShader(shader); return result; }
  setup() { const gl = this.gl; this.vs = gl.createShader(gl.VERTEX_SHADER); this.fs = gl.createShader(gl.FRAGMENT_SHADER); this.compile(this.vs, this.#vertexSrc); this.compile(this.fs, this.shaderSource); this.program = gl.createProgram(); gl.attachShader(this.program, this.vs); gl.attachShader(this.program, this.fs); gl.linkProgram(this.program); if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(this.program)); } }
  init() { const { gl, program } = this; this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.#vertices), gl.STATIC_DRAW); const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0); program.resolution = gl.getUniformLocation(program, "resolution"); program.time = gl.getUniformLocation(program, "time"); program.move = gl.getUniformLocation(program, "move"); program.zoom = gl.getUniformLocation(program, "zoom"); program.shapeParams = gl.getUniformLocation(program, "u_shapeParams"); }
  render(now = 0) { const { gl, program, buffer, canvas, mouseMove, zoom, shapeParams } = this; if (!program || gl.isProgram(program) === false) return; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.uniform2f(program.resolution, canvas.width, canvas.height); gl.uniform1f(program.time, now * 1e-3); gl.uniform2f(program.move, ...mouseMove); gl.uniform1f(program.zoom, zoom); gl.uniform3f(program.shapeParams, shapeParams.x, shapeParams.y, shapeParams.z); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
}
class PointerHandler {
  constructor(element) {
    this.active = false;
    this.moves = [0,0];
    element.addEventListener("pointerdown", () => this.active=true);
    element.addEventListener("pointerup", () => this.active=false);
    element.addEventListener("pointerleave", () => this.active=false);
    element.addEventListener("pointermove", (e) => { if(!this.active)return; this.moves=[this.moves[0]+e.movementX, this.moves[1]+e.movementY]; });
  }
  updateScale(scale) {}
  get move() {return this.moves;}
}
class Editor {
  constructor(textarea, errorfield){this.textarea=textarea;this.errorfield=errorfield; this.errorfield.style.display = 'none';}
  get hidden() {return this.textarea.classList.contains('hidden');}
  set hidden(value) {value ? this.textarea.classList.add('hidden') : this.textarea.classList.remove('hidden');}
  get text() {return this.textarea.value;}
  set text(value) {this.textarea.value=value;}
  setError(message){this.errorfield.innerHTML=message; this.errorfield.style.display = 'block';}
  clearError(){this.errorfield.textContent=''; this.errorfield.style.display = 'none';}
}

// GLSL 셰이더 (수정 없음)
const fragmentShader = `#version 300 es
precision highp float;
out vec4 O;
uniform float time;
uniform vec2 resolution;
uniform vec2 move;
uniform float zoom;
uniform vec3 u_shapeParams;
#define FC gl_FragCoord.xy
#define R resolution
#define T time
#define N normalize
#define S smoothstep
#define MN min(R.x,R.y)
#define rot(a) mat2(cos((a)-vec4(0,11,33,0)))
#define csqr(a) vec2(a.x*a.x-a.y*a.y,2.*a.x*a.y)
vec3 hsl2rgb(vec3 c){vec3 rgb=clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);return c.z+c.y*(rgb-0.5)*(1.0-abs(2.0*c.z-1.0));}
float swirls(in vec3 p){float d=0.0;vec3 c=p;for(float i=min(0.0,T);i<9.;i++){p=u_shapeParams.x*abs(p)/dot(p,p)-u_shapeParams.y;p.yz=csqr(p.yz);p=p.zxy;d+=exp(-u_shapeParams.z*abs(dot(p,c)));}return d;}
vec3 getNormal(vec3 p){vec2 e=vec2(0.001,0.0);return N(vec3(swirls(p+e.xyy)-swirls(p-e.xyy),swirls(p+e.yxy)-swirls(p-e.yxy),swirls(p+e.yyx)-swirls(p-e.yyx)));}
vec2 march(in vec3 p,vec3 rd){float d=.2,t=.0,c=0.;float maxd=length(p)-1.;float total_density=0.0;for(float i=min(.0,time);i<120.;i++){t+=d*exp(-2.*c)*0.9;c=swirls(p+rd*t);if(t>maxd)break;total_density+=c;}if(total_density<0.01)t=-1.0;return vec2(t,S(0.0,0.8,total_density*0.05));}
void cam(inout vec3 p){p.yz*=rot(move.y*6.3/MN-T*0.15);p.xz*=rot(-move.x*6.3/MN+T*0.075);}
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 starfield(vec3 rd){vec3 col=vec3(0.0);for(float i=1.0;i<=3.0;i++){vec3 p=rd*(20.0*i+15.0);vec2 id=floor(p.xy+i*10.0);float n=hash(id);if(n>0.992){float star_twinkle=sin(T*(n*5.0)+id.x)*0.5+0.5;vec2 gv=fract(p.xy+i*10.0)-0.5;float star_size=(1.0-i/4.0)*0.04;float d=length(gv);vec3 star_color=mix(vec3(0.988,0.859,0.749),vec3(1.0,0.92,0.85),n);col+=star_color*star_twinkle*S(star_size,star_size*0.5,d)*(n-0.992)*200.0;}}return col;}
void main(){vec2 uv_3d=(FC-.5*R)/MN;vec3 p=vec3(0,0,-zoom),rd=N(vec3(uv_3d,1));cam(p);cam(rd);vec3 backgroundColor=vec3(0.941,0.988,0.831);vec3 particleColor=starfield(rd);vec2 marchResult=march(p,rd);float hitDist=marchResult.x;float fractalDensity=marchResult.y;vec3 fractalColor=vec3(0.0);if(hitDist>0.0){vec3 hitPos=p+rd*hitDist;vec3 normal=getNormal(hitPos);vec3 lightPos=p+vec3(5.0,5.0,-10.0);vec3 lightDir=N(lightPos-hitPos);vec3 viewDir=N(p-hitPos);float wrap=0.3;float wrap_diffuse=(dot(normal,lightDir)+wrap)/(1.0+wrap);wrap_diffuse=max(0.0,wrap_diffuse);float rim=pow(1.0-max(0.0,dot(viewDir,normal)),2.5);float ao=1.0-swirls(hitPos+normal*0.1)*0.5;float hue=fract(rd.x*0.5+rd.y*0.3+T*0.05);vec3 basePastelColor=hsl2rgb(vec3(hue,0.7,0.8));fractalColor=basePastelColor*(wrap_diffuse*0.6+0.4)*(ao*0.7+0.3);fractalColor+=vec3(1.0)*rim*0.6;float specular=pow(max(0.0,dot(reflect(-lightDir,normal),viewDir)),32.0);fractalColor+=vec3(1.0)*specular*0.4;}vec3 col=mix(vec3(0.0),fractalColor,fractalDensity*1.2);col+=particleColor*0.5;O=vec4(col,1);}
`;

// --- JavaScript 로직 ---
let renderer, pointers;
let isMorphing = false;
let morphProgress = 0.0;
const morphSpeed = 0.03;
const MIN_PARAMS = new THREE.Vector3(0.5, 0.5, 12.0);
const MAX_PARAMS = new THREE.Vector3(0.9, 0.9, 25.0);
const INITIAL_PARAMS = new THREE.Vector3(0.7, 0.7, 19.0);
let fromParams = new THREE.Vector3();
let toParams = new THREE.Vector3();
let currentRenderParams = new THREE.Vector3().copy(INITIAL_PARAMS);
let handLandmarker;
let video;
let statusPanel;
let webcamRunning = false;
let predictionReady = false;
let lastVideoTime = -1;
let lastHandX = null;
let cameraYaw = 0;
let fractalIntensity = 1.0;

function isFist(landmarks) {
  // index, middle, ring, pinky
  const tips = [8, 12, 16, 20];
  const mcps = [5, 9, 13, 17];
  let folded = 0;
  for (let i = 0; i < 4; i++) {
    if (landmarks[tips[i]].y > landmarks[mcps[i]].y) folded++;
  }
  return folded === 4;
}

let fistActive = false;
let originalZoom = null;
let fistZoomOutStart = null;
const FIST_ZOOMOUT_TIMEOUT = 20000; // 20초(ms)

const canvas = document.getElementById('canvas');
const btnWebcam = document.getElementById('btnWebcam');
// 이미지 시퀀스 버튼 및 로직 제거
const btnRecordVideo = document.getElementById('btnRecordVideo');
let recorder = null;
let videoChunks = [];
let isRecording = false;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  if (renderer) renderer.updateScale(dpr);
}

function init() {
    video = document.getElementById('webcam');
    statusPanel = document.getElementById('info-panel-status');
    
    renderer = new Renderer(canvas);
    renderer.updateShader(fragmentShader);
    
    pointers = new PointerHandler(canvas);
    
    setupEventListeners();
    createHandLandmarker();
    loop(0);
    resize();
    window.addEventListener('resize', resize);
}

function setupEventListeners() {
    btnWebcam.addEventListener('click', toggleWebcam);
}

async function createHandLandmarker() {
    statusPanel.style.opacity = 1;
    try {
        console.log('HandLandmarker: Resolving vision WASM...');
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        console.log('HandLandmarker: Vision WASM resolved:', vision);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1
    });
        console.log('HandLandmarker: Model created:', handLandmarker);
    btnWebcam.disabled = false;
        statusPanel.innerText = "위 버튼을 눌러 카메라를 시작하세요 📹";
    } catch (error) {
        console.error("Hand Landmarker 초기화 실패:", error);
        statusPanel.innerText = "AI 모델 로딩에 실패했습니다.";
    }
}

function setInfoPanelState(state) {
  const panel = document.getElementById('info-panel-status');
  if (!panel) return;
  panel.classList.remove('camera-on', 'hand-detected');
  if (state === 'camera') panel.classList.add('camera-on');
  if (state === 'hand') panel.classList.add('hand-detected');
}

function toggleWebcam() {
    console.log('toggleWebcam called. Current webcamRunning:', webcamRunning);
    if (webcamRunning) {
        webcamRunning = false;
        predictionReady = false;
        if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
        video.srcObject = null;
        statusPanel.innerText = "카메라가 중지되었습니다.";
        btnWebcam.style.opacity = 0.6;
        setInfoPanelState();
    } else {
        enableCam();
        setInfoPanelState('camera');
    }
}

async function enableCam() {
    if (!handLandmarker) {
        console.error("Hand Landmarker is not ready!");
        return;
    }
    webcamRunning = true;
    btnWebcam.style.opacity = 1.0;
    statusPanel.innerText = "카메라 접근을 허용해주세요...";
    try {
        console.log('Calling getUserMedia...');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        console.log('getUserMedia success:', stream);
        video.srcObject = stream;
        video.addEventListener("loadeddata", () => {
            predictionReady = true;
            console.log('Video loadeddata event: predictionReady set to true');
        });
    } catch (err) {
        console.error("getUserMedia error:", err);
        statusPanel.innerText = "카메라를 사용할 수 없습니다.";
        webcamRunning = false;
        btnWebcam.style.opacity = 0.6;
    }
}

function loop(now) {
  // [수정 2] video.readyState 체크를 추가하여 비디오 데이터가 실제로 사용 가능한지 확인
  if (webcamRunning && predictionReady && video.readyState >= 2) {
    predictWebcamFrame();
  }
  updateMorph();
  renderer.updateMove(pointers.move);
  renderer.updateShapeParams(currentRenderParams);
  renderer.render(now);
  requestAnimationFrame(loop);
}

function predictWebcamFrame() {
  if (video.currentTime === lastVideoTime) {
      return;
  }
  lastVideoTime = video.currentTime;

  const results = handLandmarker.detectForVideo(video, Date.now());

  if (results.landmarks && results.landmarks.length > 0) {
    const handCenter = results.landmarks[0][9];
    const landmarks = results.landmarks[0];

    // --- 좌우 흔들기 감지 및 카메라 회전 ---
    let dx = 0, dy = 0;
    if (lastHandX !== null) {
      dx = handCenter.x - lastHandX;
      cameraYaw += dx * 2.0; // 감도 조절 (2.0은 예시)
    }
    let lastHandY = predictWebcamFrame._lastHandY || null;
    if (lastHandY !== null) {
      dy = handCenter.y - lastHandY;
    }
    predictWebcamFrame._lastHandY = handCenter.y;
    lastHandX = handCenter.x;
    pointers.moves[0] = cameraYaw * 200; // 좌우 회전값을 렌더러에 반영

    // --- 주먹 판별 및 줌아웃/리셋 ---
    if (isFist(landmarks)) {
      if (!fistActive) {
        fistActive = true;
        originalZoom = renderer.zoom;
        renderer.zoom = 40.0; // 최대 줌아웃 (필요시 조정)
        fistZoomOutStart = Date.now();
        resetScene(); // 프랙탈 리셋
      } else {
        // 이미 fistActive 상태라면, 20초 경과 체크
        if (fistZoomOutStart && Date.now() - fistZoomOutStart > FIST_ZOOMOUT_TIMEOUT) {
          renderer.zoom = originalZoom !== null ? originalZoom : 16.0;
          fistActive = false;
          originalZoom = null;
          fistZoomOutStart = null;
        }
      }
    } else {
      if (fistActive) {
        fistActive = false;
        if (originalZoom !== null) renderer.zoom = originalZoom;
        originalZoom = null;
        fistZoomOutStart = null;
      }
    }

    // --- 손 움직임 속도에 따라 프랙탈 생성 강도/빈도 조절 ---
    const speed = Math.sqrt(dx * dx + dy * dy);
    // 속도에 따라 1~5 범위로 intensity 조절 (감도 필요시 조정)
    fractalIntensity = 1.0 + Math.min(4.0, speed * 50.0);
    // 방향성(좌우/상하)도 필요시 활용 가능

    updateTargetParamsFromHand(handCenter);
    setInfoPanelState('hand');
    statusPanel.innerText = "손이 인식되었습니다. 움직여보세요.";
  } else {
    setInfoPanelState('camera');
    statusPanel.innerText = "카메라에 손을 보여주세요.";
    lastHandX = null; // 손이 사라지면 추적 초기화
    predictWebcamFrame._lastHandY = null;
    fistActive = false;
    originalZoom = null;
    fistZoomOutStart = null;
    fractalIntensity = 1.0;
  }
}

function updateTargetParamsFromHand(hand) {
    if (!hand) return;
    const newX = THREE.MathUtils.mapLinear(1 - hand.x, 0.2, 0.8, MIN_PARAMS.x, MAX_PARAMS.x);
    const newY = THREE.MathUtils.mapLinear(1 - hand.y, 0.2, 0.8, MIN_PARAMS.y, MAX_PARAMS.y);
    const newZ = THREE.MathUtils.mapLinear(hand.z, -0.1, 0.1, MAX_PARAMS.z, MIN_PARAMS.z);
    
    const newParams = new THREE.Vector3(
        THREE.MathUtils.clamp(newX, MIN_PARAMS.x, MAX_PARAMS.x),
        THREE.MathUtils.clamp(newY, MIN_PARAMS.y, MAX_PARAMS.y),
        THREE.MathUtils.clamp(newZ, MIN_PARAMS.z, MAX_PARAMS.z)
    );

    if (!toParams.equals(newParams)) {
        fromParams.copy(currentRenderParams);
        toParams.copy(newParams);
        morphProgress = 0.0;
  isMorphing = true;
    }
}

function updateMorph() {
    if (!isMorphing) return;
    morphProgress += morphSpeed;
    if (morphProgress >= 1.0) {
        morphProgress = 1.0;
  isMorphing = false;
        currentRenderParams.copy(toParams);
    } else {
        const t = morphProgress * morphProgress * (3 - 2 * morphProgress);
        currentRenderParams.lerpVectors(fromParams, toParams, t);
    }
}

// Renderer에 fractalIntensity를 전달 (updateShapeParams 등에서 활용)
// updateShapeParams를 아래와 같이 수정:
Renderer.prototype.updateShapeParams = function(params) {
  this.shapeParams.copy(params);
  this.fractalIntensity = fractalIntensity;
};
// 그리고 render 함수에서 fractalIntensity를 셰이더 uniform으로 전달(가능하다면):
// gl.uniform1f(program.fractalIntensity, this.fractalIntensity);
// (셰이더에서 uniform float fractalIntensity; 선언 필요)

function resetScene() {
    // 프랙탈 상태를 초기화하는 로직을 여기에 추가
    // 예: 현재 파라미터를 초기값으로 설정
    currentRenderParams.copy(INITIAL_PARAMS);
    fromParams.copy(INITIAL_PARAMS);
    toParams.copy(INITIAL_PARAMS);
    morphProgress = 0.0;
    isMorphing = false;
    fractalIntensity = 1.0; // 리셋 시 프랙탈 강도도 초기화
}

init();

window.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('title-overlay');
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 1000);
  }, 5000);

  // 모바일 안내 메시지 일정 시간 후 사라지게
  const infoPanelMain = document.getElementById('info-panel-main');
  if (infoPanelMain) {
    setTimeout(() => {
      infoPanelMain.style.opacity = '0';
      setTimeout(() => { infoPanelMain.style.display = 'none'; }, 1000);
    }, 4000);
  }
});

if (btnRecordVideo) {
  btnRecordVideo.addEventListener('click', () => {
    if (!isRecording) {
      // 녹화 시작
      const stream = canvas.captureStream(30); // 30fps
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      videoChunks = [];
      recorder.ondataavailable = e => videoChunks.push(e.data);
      recorder.onstop = e => {
        const blob = new Blob(videoChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fractal-recording-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      };
      recorder.start();
      isRecording = true;
      btnRecordVideo.textContent = '비디오 녹화 정지';
    } else {
      // 녹화 정지
      recorder.stop();
      isRecording = false;
      btnRecordVideo.textContent = '비디오 녹화 시작';
    }
  });
} 