/* ═══════════════════════════════════════════════════
   avatar.js — Ready Player Me Avatar "Alex"
   Correct arm/hand animations — offset from bind pose
═══════════════════════════════════════════════════ */

let _scene, _cam, _ren, _clk;
let _model, _bones = {}, _bindQ = {};
let _av = {
  talking:false, listening:false, waving:false,
  t:0, breathT:0, blinkT:0, jawOpen:0, jawTarget:0, wavePhase:0,
  /* Look around */
  lookT:0, lookNextT:3, lookX:0, lookY:0, lookTX:0, lookTY:0,
  /* Idle wave */
  idleWaveT:0, idleWaveInterval: 25 + Math.random() * 20,
  /* Blink using eyelids */
  blinkPhase:0, /* 0=open, 1=closing */
  /* Weight shift */
  weightT:0,
};

function initAvatar() {
  const panel = document.getElementById('avPanel');
  if (!panel) return;
  const old = document.getElementById('av-canvas');
  if (old) old.remove();

  const canvas = document.createElement('canvas');
  canvas.id = 'av-canvas';
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;display:block;';
  panel.insertBefore(canvas, panel.firstChild);

  if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
    console.error('Three.js / GLTFLoader not ready'); showFallback(); return;
  }
  _boot(canvas, panel);
}

function _boot(canvas, panel) {
  _ren = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  _ren.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _ren.shadowMap.enabled = true;
  _ren.shadowMap.type    = THREE.PCFSoftShadowMap;
  _ren.outputEncoding    = THREE.sRGBEncoding;
  _ren.toneMapping       = THREE.ACESFilmicToneMapping;
  _ren.toneMappingExposure = 1.25;

  _scene = new THREE.Scene();
  _clk   = new THREE.Clock();

  const W = panel.clientWidth  || 420;
  const H = panel.clientHeight || 600;
  _ren.setSize(W, H);
  _cam = new THREE.PerspectiveCamera(32, W / H, 0.01, 100);
  _cam.position.set(0, 0.95, 3.6);
  _cam.lookAt(0, 0.85, 0);

  /* Lights */
  _scene.add(new THREE.AmbientLight(0xfff0e8, 0.7));
  const sun = new THREE.DirectionalLight(0xfff8f0, 2.2);
  sun.position.set(2, 5, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); _scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8090ff, 0.5);
  fill.position.set(-3, 2, 1); _scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff2800, 0.4);
  rim.position.set(0, 3, -5); _scene.add(rim);
  const pt = new THREE.PointLight(0xc8972a, 1.0, 6);
  pt.position.set(0, 0.5, 2); _scene.add(pt);

  /* Floor */
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 48),
    new THREE.MeshStandardMaterial({ color:0x160a04, roughness:0.9, metalness:0.05 })
  );
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  _scene.add(floor);

  /* Gold ring */
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.75, 64),
    new THREE.MeshBasicMaterial({ color:0xc8972a, transparent:true, opacity:0.12, side:THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  _scene.add(ring);

  try {
    new ResizeObserver(() => {
      const w = panel.clientWidth, h = panel.clientHeight;
      if (!w || !h) return;
      _cam.aspect = w / h; _cam.updateProjectionMatrix(); _ren.setSize(w, h);
    }).observe(panel);
  } catch(e) {}

  _loadModel();
  _loop();
}

function _loadModel() {
  const ui = _mkLoadUI();
  new THREE.GLTFLoader().load('/static/assets/avatar.glb?v=11',
    gltf => {
      ui.remove();
      _model = gltf.scene;

      /* Auto-fit: scale so height ≈ 1.75m, place feet at y=0 */
      const box = new THREE.Box3().setFromObject(_model);
      const sz  = new THREE.Vector3(); box.getSize(sz);
      const sc  = 1.75 / sz.y;
      _model.scale.setScalar(sc);
      _model.position.y = -box.min.y * sc;
      _model.position.x = 0;
      _model.rotation.y = 0;

      _model.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = obj.receiveShadow = true;
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => {
            if (m?.map) m.map.anisotropy = 4;
            if (m) m.depthWrite = true;
          });
        }
      });
      _scene.add(_model);

      /* Fixed camera position for humanoid avatar */
      _cam.fov = 32;
      _cam.position.set(0, 0.95, 3.6);
      _cam.lookAt(0, 0.85, 0);
      _cam.updateProjectionMatrix();
      console.log('Bones found:', Object.keys(_bones).length, Object.keys(_bones).join(', '));

      /* Collect bones AND save their bind-pose quaternions */
      const _boneNameMap = {
        /* RPM naming */
        'Hips':'hips','Spine':'sp1','Spine1':'sp2','Spine2':'sp3',
        'Neck':'neck','Head':'head',
        'LeftEye':'eyeL','RightEye':'eyeR',
        'LeftShoulder':'shlL','LeftArm':'armL','LeftForeArm':'forL','LeftHand':'hnL',
        'LeftHandIndex1':'liI1','LeftHandIndex2':'liI2',
        'LeftHandMiddle1':'liM1','LeftHandRing1':'liR1',
        'LeftHandPinky1':'liP1',
        'LeftHandThumb1':'liT1','LeftHandThumb2':'liT2',
        'RightShoulder':'shlR','RightArm':'armR','RightForeArm':'forR','RightHand':'hnR',
        'RightHandIndex1':'riI1','RightHandIndex2':'riI2',
        'RightHandMiddle1':'riM1','RightHandRing1':'riR1',
        'RightHandPinky1':'riP1',
        'RightHandThumb1':'riT1','RightHandThumb2':'riT2',
        /* Renderpeople / Mixamo naming */
        'hip':'hips','spine_01':'sp1','spine_02':'sp2','spine_03':'sp3',
        'shoulder_l':'shlL','upperarm_l':'armL','lowerarm_l':'forL','hand_l':'hnL',
        'index_01_l':'liI1','index_02_l':'liI2',
        'middle_01_l':'liM1','ring_01_l':'liR1',
        'pinky_01_l':'liP1',
        'thumb_01_l':'liT1','thumb_02_l':'liT2',
        'shoulder_r':'shlR','upperarm_r':'armR','lowerarm_r':'forR','hand_r':'hnR',
        'index_01_r':'riI1','index_02_r':'riI2',
        'middle_01_r':'riM1','ring_01_r':'riR1',
        'pinky_01_r':'riP1',
        'thumb_01_r':'riT1','thumb_02_r':'riT2',
        'eye_l':'eyeL','eye_r':'eyeR',
        'eyelid_l':'lidL','eyelid_r':'lidR',
        'jaw':'jaw','neck':'neck','head':'head',
      };
      _model.traverse(obj => {
        const n = obj.name;
        let key = _boneNameMap[n];
        if (!key) {
          for (const [boneName, shortKey] of Object.entries(_boneNameMap)) {
            if (n.startsWith(boneName + '_') || n.startsWith(boneName + '.')) {
              key = shortKey;
              break;
            }
          }
        }
        if (key && !_bones[key]) {
          _bones[key] = obj;
          _bindQ[key] = obj.quaternion.clone();
        }
      });

      console.log('Alex loaded. Bones:', Object.keys(_bones).length);

      /* Debug: log bind pose quaternions to find correct axes */
      ['armR','armL','forR','forL'].forEach(k => {
        const b = _bones[k];
        if (b) {
          const wp = new THREE.Vector3();
          b.getWorldPosition(wp);
          console.log(k, 'worldPos:', wp.x.toFixed(3), wp.y.toFixed(3), wp.z.toFixed(3),
            'quatBind:', _bindQ[k].x.toFixed(4), _bindQ[k].y.toFixed(4), _bindQ[k].z.toFixed(4), _bindQ[k].w.toFixed(4));
        }
      });

      /* Force arms down from T-pose IMMEDIATELY */
      _forceArmsDown();

      /* Welcome */
      setTimeout(() => {
        setBubble("Hi! I'm Alex, your liquor expert. How can I help?", 'happy');
        setTimeout(() => speak("Welcome! I'm Alex, your personal liquor expert. How can I help you today?"), 700);
      }, 1000);
    },
    xhr => {
      if (xhr.total > 0) {
        const p = Math.round(xhr.loaded / xhr.total * 100);
        const b = ui.querySelector('.lb'); if (b) b.style.width = p + '%';
        const t = ui.querySelector('.lt'); if (t) t.textContent = 'Loading Alex… ' + p + '%';
      }
    },
    err => { console.error('GLB error:', err); ui.remove(); showFallback(); }
  );
}

/* ── Render loop ── */
function _loop() {
  requestAnimationFrame(_loop);
  if (!_ren || !_scene || !_cam) return;
  const dt = Math.min(_clk.getDelta(), 0.05);
  _av.t += dt; _av.breathT += dt; _av.blinkT += dt;
  if (_model && Object.keys(_bones).length > 0) _animate(dt);
  /* Static model: gentle idle sway */
  if (_model && Object.keys(_bones).length === 0) {
    _model.rotation.y = Math.sin(_av.t * 0.3) * 0.06;
  }
  _cam.position.x = Math.sin(_av.t * 0.18) * 0.04;
  _ren.render(_scene, _cam);
}

/* ── Quaternion helpers ── */
const _TQ  = new THREE.Quaternion();
const _E   = new THREE.Euler();
const _ZERO = new THREE.Quaternion();

/* Apply an OFFSET rotation on top of bind pose */
function _rotOffset(key, x, y, z, s) {
  const bone = _bones[key];
  const bind = _bindQ[key];
  if (!bone || !bind) return;
  _E.set(x, y, z, 'XYZ');
  _TQ.setFromEuler(_E);
  // target = bind * offset
  const target = bind.clone().multiply(_TQ);
  bone.quaternion.slerp(target, s);
}

/* Reset a bone toward its bind pose */
function _rotBind(key, s) {
  const bone = _bones[key];
  const bind = _bindQ[key];
  if (!bone || !bind) return;
  bone.quaternion.slerp(bind, s);
}

/* ── Main animation ── */
function _animate(dt) {
  const t = _av.t;

  /* ══ 1. BREATHING — chest rises and falls ══ */
  const br = Math.sin(_av.breathT * 0.9) * 0.018;
  const br2 = Math.sin(_av.breathT * 0.9 + 0.3) * 0.012;
  _rotOffset('sp1', br,        0, 0, 0.08);
  _rotOffset('sp2', br2,       0, 0, 0.06);
  _rotOffset('sp3', br * 0.4,  0, 0, 0.05);

  /* ══ 2. LOOK AROUND — head turns with random pauses ══ */
  _av.lookT += dt;
  if (_av.lookT > _av.lookNextT) {
    _av.lookT = 0;
    _av.lookNextT = 2.5 + Math.random() * 4.0;
    if (Math.random() < 0.6) {
      /* Look to a random direction */
      _av.lookTX = (Math.random() - 0.5) * 0.12;
      _av.lookTY = (Math.random() - 0.5) * 0.18;
    } else {
      /* Return to center */
      _av.lookTX = 0;
      _av.lookTY = 0;
    }
  }
  _av.lookX += (_av.lookTX - _av.lookX) * 0.02;
  _av.lookY += (_av.lookTY - _av.lookY) * 0.02;

  const headBob = _av.talking ? Math.sin(t * 5.5) * 0.03 : 0;
  const neckNod = _av.talking ? Math.sin(t * 4.2) * 0.015 : 0;
  _rotOffset('head', _av.lookX + headBob, _av.lookY, Math.sin(t * 0.27) * 0.008, 0.10);
  _rotOffset('neck', _av.lookX * 0.4 + neckNod, _av.lookY * 0.5, 0, 0.08);

  /* ══ 3. SMILE — warm eyelid position (slightly raised) ══ */
  const smileLid = _av.blinkPhase === 0 ? 0.06 : 0;
  _rotOffset('lidL', smileLid, 0, 0, 0.05);
  _rotOffset('lidR', smileLid, 0, 0, 0.05);

  /* ══ 4. EYE MOVEMENT — subtle tracking ══ */
  const eyeX = _av.lookY * 0.5 + Math.sin(t * 0.35) * 0.015;
  const eyeY = _av.lookX * 0.3 + Math.sin(t * 0.25) * 0.01;
  _rotOffset('eyeL', eyeY, eyeX, 0, 0.06);
  _rotOffset('eyeR', eyeY, eyeX, 0, 0.06);

  /* ══ 5. BLINK — realistic eyelid blink ══ */
  _av.blinkT += dt;
  if (_av.blinkPhase === 0 && _av.blinkT > 3.0 + Math.random() * 3.0) {
    _av.blinkPhase = 1;
    _av.blinkT = 0;
    /* Close eyelids */
    const lL = _bones.lidL, lR = _bones.lidR;
    if (lL) {
      _rotOffset('lidL', -0.4, 0, 0, 0.6);
      _rotOffset('lidR', -0.4, 0, 0, 0.6);
      /* Also squish eye bones as fallback */
      if (_bones.eyeL) { _bones.eyeL.scale.y = 0.1; _bones.eyeR.scale.y = 0.1; }
      setTimeout(() => {
        _av.blinkPhase = 0;
        if (_bones.eyeL) { _bones.eyeL.scale.y = 1; _bones.eyeR.scale.y = 1; }
      }, 120 + Math.random() * 60);
    } else {
      /* Fallback: use eye scale if no eyelid bones */
      const eL = _bones.eyeL, eR = _bones.eyeR;
      if (eL) { eL.scale.y = 0.05; eR.scale.y = 0.05;
        setTimeout(() => { if(eL){eL.scale.y=1;eR.scale.y=1;} _av.blinkPhase=0; }, 110);
      } else { _av.blinkPhase = 0; }
    }
  }

  /* ══ 6. JAW — talking lip sync ══ */
  _av.jawTarget = _av.talking ? Math.abs(Math.sin(t * 13)) * 0.04 + Math.abs(Math.sin(t * 7.3)) * 0.02 : 0;
  _av.jawOpen = _av.jawOpen * 0.7 + _av.jawTarget * 0.3;
  if (_av.jawOpen > 0.003) _rotOffset('jaw', 0, 0, _av.jawOpen, 0.35);

  /* ══ 7. WEIGHT SHIFT — subtle body sway ══ */
  _av.weightT += dt;
  const weightShift = Math.sin(_av.weightT * 0.25) * 0.008;
  const hipSway = Math.sin(_av.weightT * 0.18) * 0.006;
  _rotOffset('hips', 0, weightShift, hipSway, 0.04);

  /* ══ ARM POSES ══ */
  if      (_av.talking)   _talk(t, dt);
  else if (_av.listening) _listen(t);
  else                    _idle(t);
}

/* ── Force arms down — auto-detect correct rotation axis ── */
function _forceArmsDown() {
  /* Try all 3 axes with large values, keep the one that moves arm Y position lowest */
  ['armR','armL'].forEach(key => {
    const bone = _bones[key], bind = _bindQ[key];
    if (!bone || !bind) return;
    
    /* Get child bone to measure arm direction */
    const child = key === 'armR' ? _bones.forR : _bones.forL;
    if (!child) return;
    
    let bestAxis = 0, bestAngle = 0, lowestY = 999;
    const testAngles = [-1.5, -1.0, -0.5, 0.5, 1.0, 1.5];
    
    for (let axis = 0; axis < 3; axis++) {
      for (const angle of testAngles) {
        const e = new THREE.Euler(
          axis===0 ? angle : 0,
          axis===1 ? angle : 0,
          axis===2 ? angle : 0, 'XYZ');
        const q = new THREE.Quaternion().setFromEuler(e);
        bone.quaternion.copy(bind.clone().multiply(q));
        bone.updateWorldMatrix(true, true);
        const wp = new THREE.Vector3();
        child.getWorldPosition(wp);
        if (wp.y < lowestY) {
          lowestY = wp.y;
          bestAxis = axis;
          bestAngle = angle;
        }
      }
    }
    
    /* Apply the best rotation that puts the arm lowest (most downward) */
    const e = new THREE.Euler(
      bestAxis===0 ? bestAngle : 0,
      bestAxis===1 ? bestAngle : 0,
      bestAxis===2 ? bestAngle : 0, 'XYZ');
    const q = new THREE.Quaternion().setFromEuler(e);
    bone.quaternion.copy(bind.clone().multiply(q));
    
    console.log(key + ': best axis=' + ['X','Y','Z'][bestAxis] + ' angle=' + bestAngle.toFixed(2) + ' forearmY=' + lowestY.toFixed(3));
    
    /* Store the discovered axis and direction for use in gestures */
    if (!window._armAxis) window._armAxis = {};
    window._armAxis[key] = { axis: bestAxis, downSign: Math.sign(bestAngle) };
  });
}

function _setDirect(key, order, angles) {
  const bone = _bones[key], bind = _bindQ[key];
  if (!bone || !bind) return;
  const e = new THREE.Euler(angles[0], angles[1], angles[2], order);
  const q = new THREE.Quaternion().setFromEuler(e);
  bone.quaternion.copy(bind.clone().multiply(q));
}

/* ── Arm rotation helper: uses discovered axis, DIRECT set (no slerp) ── */
function _armSet(key, pitch, yaw, roll) {
  const info = window._armAxis && window._armAxis[key];
  if (!info) return;
  const ax = info.axis;
  const p = pitch * info.downSign;
  const angles = [0,0,0];
  angles[ax] = p;
  /* Add yaw/roll to the other two axes */
  const other1 = (ax + 1) % 3;
  const other2 = (ax + 2) % 3;
  angles[other1] += yaw;
  angles[other2] += roll;
  _setDirect(key, 'XYZ', angles);
}

/* ── Arm rotation helper with slerp for smooth transitions ── */
function _armRot(key, pitch, yaw, roll, s) {
  const info = window._armAxis && window._armAxis[key];
  if (!info) { _rotOffset(key, pitch, yaw, roll, s); return; }
  const ax = info.axis;
  const p = pitch * info.downSign;
  const angles = [0,0,0];
  angles[ax] = p;
  const other1 = (ax + 1) % 3;
  const other2 = (ax + 2) % 3;
  angles[other1] += yaw;
  angles[other2] += roll;
  _rotOffset(key, angles[0], angles[1], angles[2], s);
}

/* Down amount constant */
const _DOWN = 0.7;

/* ── IDLE: professional standing pose ── */
function _idle(t) {
  /* Arms at sides — only subtle breathing sway */
  const br = Math.sin(t * 0.45) * 0.008;
  _armSet('armR', _DOWN + br, 0, 0);
  _armSet('armL', _DOWN - br, 0, 0);
  _setDirect('forR', 'XYZ', [0, 0, 0]);
  _setDirect('forL', 'XYZ', [0, 0, 0]);
  _setDirect('hnR', 'XYZ', [0, 0, 0]);
  _setDirect('hnL', 'XYZ', [0, 0, 0]);
}

/* ── TALK: minimal professional gestures ── */
function _talk(t, dt) {
  /* Arms stay mostly at sides with very slight movement */
  const g = Math.sin(t * 1.8) * 0.06;
  _armSet('armR', _DOWN - 0.08 + g, 0.03, 0);
  _armSet('armL', _DOWN + 0.02, 0, 0);
  _setDirect('forR', 'XYZ', [-0.08 + Math.sin(t*2.0)*0.04, 0, 0]);
  _setDirect('forL', 'XYZ', [0, 0, 0]);
  _setDirect('hnR', 'XYZ', [Math.sin(t*2.2)*0.03, 0, 0]);
  _setDirect('hnL', 'XYZ', [0, 0, 0]);
}

/* ── LISTEN: attentive standing ── */
function _listen(t) {
  const br = Math.sin(t * 0.5) * 0.005;
  _armSet('armR', _DOWN + br, 0, 0);
  _armSet('armL', _DOWN - br, 0, 0);
  _setDirect('forR', 'XYZ', [0, 0, 0]);
  _setDirect('forL', 'XYZ', [0, 0, 0]);
  _setDirect('hnR', 'XYZ', [0, 0, 0]);
  _setDirect('hnL', 'XYZ', [0, 0, 0]);
}

function _mkLoadUI() {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,4,2,0.92)';
  d.innerHTML = `<div style="width:48px;height:48px;border:2.5px solid rgba(200,151,42,0.2);border-top-color:#C8972A;border-radius:50%;animation:avSpin 1s linear infinite;margin-bottom:16px"></div><div class="lt" style="font-size:12px;color:rgba(200,151,42,0.82);font-family:sans-serif;margin-bottom:12px">Loading Alex…</div><div style="width:160px;height:3px;background:rgba(200,151,42,0.14);border-radius:2px"><div class="lb" style="height:100%;width:0%;background:linear-gradient(90deg,#A07820,#E8B84B);border-radius:2px;transition:width .25s ease"></div></div><style>@keyframes avSpin{to{transform:rotate(360deg)}}</style>`;
  document.getElementById('avPanel')?.appendChild(d);
  return d;
}

function showFallback() {
  const p = document.getElementById('avPanel'); if (!p) return;
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(245,237,216,0.5);font-family:sans-serif;font-size:13px;text-align:center;padding:1rem';
  d.innerHTML = '<div style="font-size:60px;margin-bottom:14px">🧑‍💼</div><div style="color:#C8972A;font-size:17px;margin-bottom:5px">Alex</div><div>AI Sommelier</div>';
  p.appendChild(d);
}

/* ── Public API ── */
function setAvatarTalking(on) {
  if (on) {
    _av.listening = false;
    _av.waving = false;
    _av.talking = true;
  } else {
    _av.talking = false;
  }
}
function setAvatarListening(on) {
  _av.listening = on; _av.talking = false; _av.waving = false;
}
function setEmotion(name) {
  const m = { happy:'😊', excited:'😄', thinking:'🤔', surprised:'😮', cool:'😎' };
  const el = document.getElementById('emoBadge');
  if (el) el.textContent = m[name] || '😊';
}
function triggerWave(durationMs) {
  /* Gentle nod instead of wave */
  setBubble("Hey! I'm listening — go ahead!", 'happy');
}

function init3D()    { initAvatar(); }
function animate3D() {}
